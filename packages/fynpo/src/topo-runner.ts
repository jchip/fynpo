//
// run tasks for packages in topo order, ensuring a package's dependencies finish
// before it's run.
//

/* eslint-disable complexity, max-params */

import Promise from "bluebird";
import _ from "lodash";
import ItemQueue, { ItemQueueResult } from "item-queue";
import { FynpoTopoPackages, PackageDepData, pkgInfoId } from "@fynpo/base";

type PackageRunInfo = {
  depData: PackageDepData;
  status?: string;
};

/**
 * generic runner to invoke callback for packages in topo order
 */
export class TopoRunner {
  _opts;
  _totalTime: number;
  _errors: ItemQueueResult<PackageRunInfo>[];
  runInfo: Record<string, PackageRunInfo>;
  circulars: string[][];

  constructor(topo: FynpoTopoPackages, opts) {
    this.runInfo = {};
    for (const depData of topo.sorted) {
      this.runInfo[depData.pkgInfo.path] = {
        depData,
        status: "",
      };
    }
    this._errors = [];
    this._totalTime = 0;
    this._opts = opts;
    this.circulars = [];
  }

  run(info: PackageRunInfo, queue: PackageRunInfo[], trace: string[], nesting = false) {
    if (!info) {
      return true;
    }

    const { pkgInfo } = info.depData;
    const pkgRefs = [pkgInfo.name, pkgInfo.path, pkgInfoId(pkgInfo)];

    if (!this.runInfo.hasOwnProperty(pkgInfo.path)) {
      return true;
    }

    if (!_.isEmpty(this._opts.ignore) && pkgRefs.find((r) => this._opts.ignore.includes(r))) {
      return true;
    }

    if (
      !nesting &&
      !_.isEmpty(this._opts.only) &&
      !pkgRefs.find((r) => this._opts.only.includes(r))
    ) {
      return true;
    }

    if (info.status === "pending") {
      return false;
    }

    if (info.status === "done") {
      return true;
    }

    let pending = 0;

    for (const path in info.depData.localDepsByPath) {
      const localDep = info.depData.localDepsByPath[path];
      if (localDep && localDep.semver.startsWith("weaklink:")) {
        continue;
      }
      if (trace.includes(path) || info.depData.pkgInfo.path === path) {
        const fullTraces = trace
          .concat(info.depData.pkgInfo.path, path)
          .map((x) => (x === path ? `*${path}*` : x));
        this.circulars.push(fullTraces);
      } else {
        const nTrace = [].concat(trace, info.depData.pkgInfo.path);
        if (!this.run(this.runInfo[path], queue, nTrace, true)) {
          pending++;
          break;
        }
      }
    }

    if (pending === 0 && !info.status) {
      queue.push(info);
      info.status = "pending";
    }

    return false;
  }

  getMore() {
    const queue: PackageRunInfo[] = [];

    _.each(this.runInfo, (info: PackageRunInfo) => {
      this.run(info, queue, []);
    });

    return queue;
  }

  async start({ concurrency = 3, processor, stopOnError = true }) {
    const start = Date.now();

    const itemQ = new ItemQueue<PackageRunInfo>({
      Promise,
      concurrency,
      stopOnError,
      processItem: (item: PackageRunInfo) => {
        const pkgInfo = item.depData.pkgInfo;
        return processor(pkgInfo, item.depData);
      },
      handlers: {
        doneItem: (data: any) => {
          const item: PackageRunInfo = data.item;
          if (item) {
            item.status = "done";
          }
          const items = this.getMore();
          itemQ.addItems(items, true);
        },
        done: () => {
          this._totalTime = Date.now() - start;
          // return this.restorePkgJson();
        },
        failItem: (data) => {
          this._errors.push(data);
          // this.restorePkgJson();
        },
      },
    });

    return itemQ.addItems(this.getMore()).wait();
  }
}
