"use strict";

const expect = require("chai").expect;
const PkgDepLocker = require("../../lib/pkg-dep-locker");

describe("pkg-dep-locker", function() {
  const item = { name: "@anthropic-ai/sdk" };
  const version = "0.52.0";

  const convertTarball = (registry, tarballUrl) => {
    const locker = new PkgDepLocker(false, true, {
      _pkgSrcMgr: {
        getRegistryUrl: () => registry
      }
    });

    locker._lockData = {
      [item.name]: {
        _: {
          "^0.52.0": version
        },
        [version]: {
          $: 0,
          _: tarballUrl
        }
      }
    };

    return locker.convert(item).versions[version].dist.tarball;
  };

  it("should keep a pathful registry tarball URL unchanged", () => {
    const tarballUrl =
      "https://packages.idme.co/artifactory/api/npm/npm/@anthropic-ai/sdk/-/sdk-0.52.0.tgz";

    expect(convertTarball("https://packages.idme.co/artifactory/api/npm/npm/", tarballUrl)).to.equal(
      tarballUrl
    );
  });

  it("should rewrite a pathful registry tarball URL without duplicating the registry path", () => {
    const currentRegistry = "https://packages.idme.co/artifactory/api/npm/npm/";
    const tarballUrl =
      "https://old-packages.idme.co/artifactory/api/npm/npm/@anthropic-ai/sdk/-/sdk-0.52.0.tgz";

    expect(convertTarball(currentRegistry, tarballUrl)).to.equal(
      "https://packages.idme.co/artifactory/api/npm/npm/@anthropic-ai/sdk/-/sdk-0.52.0.tgz"
    );
  });

  it("should rebuild the tarball URL when the registry base path changes", () => {
    const currentRegistry = "https://packages.idme.co/artifactory/api/npm/npm/";
    const tarballUrl =
      "https://packages.idme.co/repository/npm-private/@anthropic-ai/sdk/-/sdk-0.52.0.tgz";

    expect(convertTarball(currentRegistry, tarballUrl)).to.equal(
      "https://packages.idme.co/artifactory/api/npm/npm/@anthropic-ai/sdk/-/sdk-0.52.0.tgz"
    );
  });
});
