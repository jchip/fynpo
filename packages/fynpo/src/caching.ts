/* eslint-disable max-params */
import Fs from "fs";
import Path from "path";
import _ from "lodash";
import { logger } from "./logger";
import { isCI } from "./is-ci";
import mkdirp from "mkdirp";
import npmPacklist from "npm-packlist";
import { FynpoPackageInfo, PackageDepData } from "@fynpo/base";
import envPaths from "env-paths";
import { request, stream } from "undici";
import { caching } from "@fynpo/base";
import * as xaa from "xaa";
import { detailedDiff } from "deep-object-diff";
import Zlib from "zlib";
import { PassThrough, pipeline } from "stream";
import Crypto from "crypto";
import { cleanErrorStack } from "@jchip/error";

export type CacheExistType = false | "fs" | "remote";

/**
 * Copy a file
 *
 * @param src
 * @param dest
 * @returns
 */
async function copyFile(src: string, dest: string): Promise<unknown> {
  const defer = xaa.makeDefer();
  pipeline(Fs.createReadStream(src), Fs.createWriteStream(dest), defer.done);
  return defer.promise;
}

/**
 * compress a file
 *
 * @param src
 * @param dest
 * @param algorithm
 * @returns
 */
export async function compressFile(
  src: string,
  dest: string,
  algorithm: "brotli" | "gzip" = "brotli"
): Promise<unknown> {
  const defer = xaa.makeDefer();

  const streams: any[] = [Fs.createReadStream(src)];
  let ext = "";

  if (algorithm === "brotli") {
    ext = ".br";
    streams.push(Zlib.createBrotliCompress());
  } else if (algorithm === "gzip") {
    ext = ".gz";
    streams.push(Zlib.createGzip());
  } else {
    throw new Error(`fynpo caching: unknown compression algorithm ${algorithm}`);
  }

  streams.push(Fs.createWriteStream(`${dest}${ext}`));
  pipeline(streams, defer.done);

  return defer.promise;
}

/**
 * search for a cache file or its compressed versions
 *
 * @param name
 * @returns
 */
async function searchCacheFile(name: string) {
  let compress: string;
  let ext: string;
  for (const ext1 of [".br", ".gz"]) {
    const fname = `${name}${ext1}`;
    const found = await Fs.promises
      .access(fname, Fs.constants.R_OK)
      .then(() => true)
      .catch(() => false);

    if (found) {
      ext = ext1;
      compress = fname;
      break;
    }
  }

  return { name, compress, ext };
}

/**
 * Try to decompress a file by detecting for file with .br or .gz extensions
 * - If no file with .br or .gz are found, then acts as a copy file
 * @param src
 * @param dest
 * @returns
 */
async function tryDecompressFile(src: string, dest: string): Promise<unknown> {
  const defer = xaa.makeDefer();

  const { compress, ext } = await searchCacheFile(src);

  const streams: any[] = [Fs.createReadStream(compress || src)];

  let hash: Crypto.Hash;

  if (ext === ".br") {
    streams.push(Zlib.createBrotliDecompress());
  } else if (ext === ".gz") {
    streams.push(Zlib.createGunzip());
  } else {
    hash = Crypto.createHash("sha256");
    const pass = new PassThrough();
    pass.on("data", (data) => hash.update(data));
    streams.push(pass);
  }

  streams.push(Fs.createWriteStream(dest));
  pipeline(streams, (err: Error) => {
    let sha: string;
    if (!err && hash) {
      sha = caching.readHashDigest(hash);
    }
    defer.done(err, sha);
  });

  return defer.promise;
}

let warnRemoteFailure = false;

/**
 * Handle caching of package build
 */
export class PkgBuildCache {
  /** does cache exist */
  exist: CacheExistType;
  /**
   * rules for gathering the input and output
   */
  cacheRules: any;
  /**
   * gathered input files, scripts, and env to the build.
   * A hash is generated from these to tie to the output cache.
   */
  input: any;
  /**
   * gathered output files after the build
   */
  output: any;
  /**
   * path to the file to save the output meta
   */
  metaFile: string;
  fynpoOpts: any;
  /**
   * caching options
   */
  opts: any;
  /** directory for cache of the package */
  cacheDir: string;
  /** directory for cache of the output files */
  filesCacheDir: string;
  /**
   * info of the package
   */
  pkgInfo: FynpoPackageInfo;
  topDir: string;
  /**
   * directory in the repo to hold cache meta info
   */
  repoCacheMetaDir: string;
  label: string;

  /**
   *
   * @param topDir - fynpo top dir
   * @param fynpoOpts - fynpo options
   * @param rules - cache rules
   * @param label - unique label for the cache
   */
  constructor(topDir: string, fynpoOpts: any, rules: any, label: string) {
    this.topDir = topDir;

    const cachingOpts = {
      enable: true,
      dir: envPaths("fynpo").cache,
      ..._.get(fynpoOpts, "caching", {}),
    };

    if (cachingOpts.server && !cachingOpts.server.endsWith("/")) {
      cachingOpts.server = `${cachingOpts.server}/`;
    }

    this.fynpoOpts = fynpoOpts;
    this.opts = cachingOpts;
    this.repoCacheMetaDir = Path.join(this.topDir, `.fynpo/_cache-meta/${label}`);
    this.exist = false;
    this.cacheRules = rules;
    this.label = label;
  }

  /**
   * is caching enabled?
   */
  get enable(): boolean {
    return this.opts.enable;
  }

  /** set enable flag */
  set enable(f: boolean) {
    this.opts.enable = f;
  }

  /**
   * log error if remote cache operation failed
   *
   * @param err
   * @param tag
   */
  warnRemoteCacheFailure(err: Error, tag: string) {
    if (!warnRemoteFailure) {
      warnRemoteFailure = true;
      logger.warn(`${tag} - remote cache server failure - ${cleanErrorStack(err)}`);
    }
  }

  /**
   * convert a hash string into multiple segements as a path
   *
   * @param hash
   * @returns
   */
  segmentHash(hash: string) {
    return `.${hash.substring(0, 1)}/.${hash.substring(1, 2)}/.${hash.substring(2)}`;
  }

  /**
   * Get the remote URL of a cache file by its cache
   *
   * @param hash - hash of the cache
   * @param ext - file extension
   * @returns
   */
  getRemoteCacheUrl(hash: string, ext: string) {
    return `${this.opts.server}${this.label}/${this.segmentHash(hash)}${ext}`;
  }

  /**
   * convert a package path within the monorepo to a string that can be used
   * as a file name to save the cache meta for it
   * @param path
   * @returns
   */
  pkgPathToRepoMetaFilename(path: string) {
    return `${path.replace(/\@/g, "_").replace(/\//g, "~")}.json`;
  }

  /**
   * check if cache exist for a package
   *
   * @param depData
   * @returns
   */
  async checkCache(depData: PackageDepData): Promise<void> {
    if (!this.enable) {
      return;
    }

    const pkgInfo = (this.pkgInfo = depData.pkgInfo);

    // find meta from local deps
    const localDepHashes = {};
    for (const localPath in depData.localDepsByPath) {
      const repoMeta = await this.readRepoPkgCacheMetaByPath(localPath);
      if (!repoMeta) {
        logger.info(
          `doing full build in '${pkgInfo.path}'. missing cache meta for its dep '${localPath}'`
        );
        this.exist = false;
        return;
      } else {
        const { output } = repoMeta;
        logger.debug(`found local dep cache meta - '${pkgInfo.path}' -> '${localPath}'`);
        localDepHashes[localPath] = {
          input: output.data.inputHash,
          output: output.hash,
        };
      }
    }

    const inputRules = _.get(this.cacheRules, "input", {});

    const resolutions =
      inputRules.includeResolutions !== false ? _.pick(this.fynpoOpts, "resolutions") : {};

    this.input = await caching.processInput({
      cwd: Path.join(this.topDir, pkgInfo.path),
      input: inputRules,
      packageJson: pkgInfo.pkgJson,
      extra: { ...resolutions, label: this.label, localDepHashes },
    });

    this.cacheDir = Path.join(this.opts.dir, this.label, pkgInfo.name);
    this.filesCacheDir = Path.join(this.cacheDir, "files");
    this.metaFile = Path.join(this.cacheDir, `${this.input.hash}.json`);

    this.exist = false;

    try {
      // TODO: detect and remove locally corrupted cache files
      const data = await Fs.promises.readFile(this.metaFile, "utf-8");
      this.output = JSON.parse(data);
      this.output.files = Object.keys(this.output.data.fileHashes);
      this.exist = "fs";
    } catch {
      if (!warnRemoteFailure && this.opts.server) {
        try {
          const remote = await request(this.getRemoteCacheUrl(this.input.hash, ".json"));
          if (remote.statusCode === 200) {
            this.output = await remote.body.json();
            this.output.files = Object.keys(this.output.data.fileHashes);
            this.exist = "remote";
          }
        } catch (err) {
          this.warnRemoteCacheFailure(err, `checkCache(${this.input.hash})`);
        }
      }
    }
  }

  /**
   * Copy files from source to cache
   *
   * @param srcDir - source directory to copy from
   * @param targetDir - target directory to copy to
   * @param files - list of files to copy
   * @param nameMapping - mapping from file name to hash
   */
  async copyFilesToCache(
    srcDir: string,
    targetDir: string,
    files: string[],
    nameMapping: Record<string, string>
  ) {
    await mkdirp(targetDir);
    for (const file of files) {
      const srcFile = Path.join(srcDir, file);
      const targetFile = Path.join(targetDir, `${nameMapping[file]}${Path.extname(file)}`);
      if (this.opts.compression) {
        await compressFile(srcFile, targetFile, this.opts.compression);
      } else {
        await copyFile(srcFile, targetFile);
      }
    }
  }

  /**
   * Copy files from cache to source
   *
   * @param srcDir - directory to copy from
   * @param targetDir - directory to copy to
   * @param files - list of files to copy
   * @param nameMapping - mapping from file name to hash
   */
  async copyFilesFromCache(
    srcDir: string,
    targetDir: string,
    files: string[],
    nameMapping: Record<string, string>
  ) {
    const destDirs = {};
    for (const file of files) {
      const srcFile = Path.join(srcDir, `${nameMapping[file]}${Path.extname(file)}`);
      const targetFile = Path.join(targetDir, file);
      const destDir = Path.dirname(targetFile);
      if (!destDirs[destDir]) {
        await mkdirp(destDir);
        // TODO: remove existing subdir
        // ?? How to ensure that old output files are cleared?
        // ??? if old output files with cache meta exist, then verify them?
        //  ?? else just ignore and overwrite?
        destDirs[destDir] = true;
      }
      const sha = await tryDecompressFile(srcFile, targetFile);
      if (sha && sha !== nameMapping[file]) {
        const msg = `copy file ${file} from cache shasum mismatched ${sha} - ${nameMapping[file]}`;
        throw new Error(msg);
      }
    }
  }

  /**
   * gather the output files
   * @param calcHash
   * @returns
   */
  async gatherOutput(calcHash = true) {
    let preFiles = [];
    if (this.cacheRules.output.filesFromNpmPack) {
      preFiles = await npmPacklist({
        path: Path.join(this.topDir, this.pkgInfo.path),
      });
    }
    const output = await caching.processOutput({
      cwd: Path.join(this.topDir, this.pkgInfo.path),
      output: this.cacheRules.output,
      preFiles,
      inputHash: this.input.hash,
      calcHash,
    });
    return output;
  }

  /**
   * Save the cache meta data to the monorepo's temporary location
   */
  async savePkgCacheMetaToRepo() {
    await mkdirp(this.repoCacheMetaDir);
    const pkgCachingFile = Path.join(
      this.repoCacheMetaDir,
      this.pkgPathToRepoMetaFilename(this.pkgInfo.path)
    );
    await Fs.promises.writeFile(
      pkgCachingFile,
      JSON.stringify({
        input: this.input,
        output: this.output,
      })
    );
  }

  /**
   * Read a package's cache meta stored in the monorepo's directory, by using its
   * path in the monorepo.
   *
   * @param path
   * @returns
   */
  async readRepoPkgCacheMetaByPath(path: string) {
    const pkgCachingFile = Path.join(this.repoCacheMetaDir, this.pkgPathToRepoMetaFilename(path));
    try {
      return JSON.parse(await Fs.promises.readFile(pkgCachingFile, "utf-8"));
    } catch (err) {
      return undefined;
    }
  }

  /**
   * cleanup cache files, to ensure that they doesn't blow up the disk
   * @returns
   */
  async cleanCacheFiles() {
    const highCount = _.get(this.opts, "pruning.highCount", 20);
    const files = await Fs.promises.readdir(this.cacheDir);
    if (files.length <= highCount) {
      return;
    }

    const metas = await xaa.map(
      files.filter((x) => x.endsWith(".json")),
      async (f) => {
        return JSON.parse(await Fs.promises.readFile(Path.join(this.cacheDir, f), "utf-8"));
      },
      { concurrency: 10 }
    );

    const keepCount = _.get(this.opts, "pruning.keepCount", 10);
    const sorted = metas.sort((a, b) => b.access - a.access);
    const keepList = sorted.slice(0, keepCount);
    const removeList = sorted.slice(keepCount);

    const saveFiles = keepList.reduce((s, m) => {
      for (const f in m.data.fileHashes) {
        const hash = m.data.fileHashes[f];
        if (!s[hash]) {
          s[hash] = f;
        }
      }
      return s;
    }, {});

    const removed = {};
    await xaa.map(
      removeList,
      async (remove) => {
        await xaa.map(
          Object.keys(remove.data.fileHashes),
          async (file) => {
            const hash = remove.data.fileHashes[file];
            if (!removed[hash] && !saveFiles[hash]) {
              removed[hash] = file;
              const fname = Path.join(this.filesCacheDir, `${hash}${Path.extname(file)}`);
              await Promise.all([
                Fs.promises.unlink(fname).catch(_.noop),
                Fs.promises.unlink(`${fname}.br`).catch(_.noop),
                Fs.promises.unlink(`${fname}.gz`).catch(_.noop),
              ]);
            }
          },
          { concurrency: 5 }
        );

        await Fs.promises
          .unlink(Path.join(this.cacheDir, `${remove.data.inputHash}.json`))
          .catch(_.noop);
      },
      { concurrency: 5 }
    );
  }

  /**
   * convert the cache's output meta to a string for saving to cache store
   *
   * @returns
   */
  stringifyOutputMeta() {
    return JSON.stringify(_.omit(this.output, "files"));
  }

  /**
   * Save the output meta to local filesystem cache storage
   * @returns
   */
  async saveOutputMetaToCache() {
    await mkdirp(this.filesCacheDir);
    await Fs.promises.writeFile(this.metaFile, this.stringifyOutputMeta());
    return this.filesCacheDir;
  }

  /**
   * Load the output meta from local filesystem cache storage
   *
   * @returns
   */
  async loadOutputMetaFromCache() {
    if (!this.output) {
      this.output = JSON.parse(await Fs.promises.readFile(this.metaFile, "utf-8"));
    }
    if (!this.output.files) {
      this.output.files = Object.keys(this.output.data.fileHashes);
    }
    return this.output;
  }

  /**
   * Upload files to remote cache storage
   *
   */
  async uploadFilesToRemote() {
    const { output } = this;
    const files = output.files;
    const pkgDir = Path.join(this.topDir, this.pkgInfo.path);
    await xaa.map(
      files,
      async (file: string) => {
        const hash = output.data.fileHashes[file];

        await request(this.getRemoteCacheUrl(hash, Path.extname(file)), {
          body: Fs.createReadStream(Path.join(pkgDir, file)),
        });
      },
      { concurrency: 10 }
    );
  }

  /**
   * Upload the cache to remote storage
   */
  async uploadCacheToRemote() {
    // do not upload if:
    // - no server
    // - not in CI env and alwaysUploadToRemote is not true
    if (!this.opts.server || (!isCI && !this.opts.alwaysUploadToRemote)) {
      logger.debug("skip upload cache to remote in non-ci mode");
      return;
    }

    if (warnRemoteFailure) {
      return;
    }

    try {
      if (this.exist !== "remote") {
        await request(this.getRemoteCacheUrl(this.input.hash, ".json"), {
          body: this.stringifyOutputMeta(),
        });
        await this.uploadFilesToRemote();
      }
    } catch (err) {
      this.warnRemoteCacheFailure(err, "uploadCacheToRemote");
    }
  }

  /**
   * Download files from remote cache storage to local filesystem storage
   *
   * @returns
   */
  async downloadCacheFromRemote() {
    if (this.exist !== "remote") {
      logger.info("skip download files from remote, exist:", this.exist);
      return;
    }
    const { output } = this;
    await mkdirp(this.filesCacheDir);
    await xaa.map(
      output.files,
      async (file: string) => {
        const hash = output.data.fileHashes[file];
        const ext = Path.extname(file);
        const file1 = Path.join(this.filesCacheDir, `${hash}${ext}`);
        const cached = await searchCacheFile(file1);
        if (
          // did not find a compress version
          !cached.compress &&
          // an uncompressed version also not found
          !(await Fs.promises
            .access(file1, Fs.constants.R_OK)
            .then(() => true)
            .catch(() => false))
        ) {
          // download from server as uncompressed version
          await stream(this.getRemoteCacheUrl(hash, ext), { method: "GET" }, () =>
            Fs.createWriteStream(file1)
          );
        }
      },
      { concurrency: 10 }
    );
  }

  /**
   * copy build output to local filesystem cache storage
   *
   */
  async copyToCache() {
    this.output = await this.gatherOutput();

    const outputFiles = _.groupBy(this.output.files, (x) => {
      return _.get(this, ["input", "data", "fileHashes", x]) ? "both" : "output";
    });

    await this.uploadCacheToRemote();

    const pkgDir = Path.join(this.topDir, this.pkgInfo.path);
    const outFilesDir = await this.saveOutputMetaToCache();
    if (!_.isEmpty(outputFiles.output)) {
      await this.copyFilesToCache(
        pkgDir,
        outFilesDir,
        outputFiles.output,
        this.output.data.fileHashes
      );
    }
    await this.savePkgCacheMetaToRepo();
    await this.cleanCacheFiles();
  }

  /**
   * Restore output files from local filesystem cache storage
   *
   */
  async restoreFromCache() {
    const output = await this.loadOutputMetaFromCache();
    const outputFiles = _.groupBy(output.files, (x) => {
      return this.input.data.fileHashes[x] ? "both" : "output";
    });

    if (!_.isEmpty(outputFiles.output)) {
      await this.copyFilesFromCache(
        this.filesCacheDir,
        Path.join(this.topDir, this.pkgInfo.path),
        outputFiles.output,
        output.data.fileHashes
      );
    }

    output.access = Date.now();
    await this.saveOutputMetaToCache();
    await this.savePkgCacheMetaToRepo();
  }

  /**
   * When cache missed and there is existing cache details, compare it with the new input meta
   * and save the details to a log file for debugging.
   *
   * @returns
   */
  async saveCacheMissDetails() {
    if (!this.input) {
      return;
    }
    const repoCacheMeta = await this.readRepoPkgCacheMetaByPath(this.pkgInfo.path);
    if (repoCacheMeta) {
      const replacer = (_key: unknown, value: unknown) => (value === undefined ? null : value);
      const oldData = repoCacheMeta.input.data;
      const newData = this.input.data;
      const diff = detailedDiff(oldData, newData);
      await Fs.promises.writeFile(
        Path.join(this.topDir, this.pkgInfo.path, `${this.label}-cache-diff.log`),
        `${this.label} cache missed.  Date: ${new Date().toString()}
---
input data diff details
---
${JSON.stringify(diff, replacer, 2)}
---
old input data
---
${JSON.stringify(oldData, replacer, 2)}
---
new input data
---
${JSON.stringify(newData, replacer, 2)}
`
      );
    }
  }
}
