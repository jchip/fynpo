"use strict";

/**
 *  "rclonefile": "^1.0.1",
 *  "rclonefile-darwin-arm64": "^1.0.1"
 *  "rclonefile-darwin-x64": "^1.0.1",
 */

const { existsSync, readFileSync } = require("fs");
const { join } = require("path");

/**
 *
 * @returns
 */
function isMusl() {
  // For Node 10
  if (!process.report || typeof process.report.getReport !== "function") {
    try {
      const lddPath = require("child_process")
        .execSync("which ldd")
        .toString()
        .trim();
      return readFileSync(lddPath, "utf8").includes("musl");
    } catch (e) {
      return true;
    }
  } else {
    const { glibcVersionRuntime } = process.report.getReport().header;
    return !glibcVersionRuntime;
  }
}

const nativeBindingHandlers = {
  "android-arm64": {
    local: "rclonefile.android-arm64.node",
    module: "rclonefile-android-arm64"
  },
  "android-arm": {
    local: "rclonefile.android-arm-eabi.node",
    module: "rclonefile-android-arm-eabi"
  },
  "win32-x64": {
    local: "rclonefile.win32-x64-msvc.node",
    module: "rclonefile-win32-x64-msvc"
  },
  "win32-ia32": {
    local: "rclonefile.win32-ia32-msvc.node",
    module: "rclonefile-win32-ia32-msvc"
  },
  "win32-arm64": {
    local: "rclonefile.win32-arm64-msvc.node",
    module: "rclonefile-win32-arm64-msvc"
  },
  "darwin-universal": {
    local: "rclonefile.darwin-universal.node",
    module: "rclonefile-darwin-universal"
  },
  "darwin-x64": {
    local: "rclonefile.darwin-x64.node",
    module: "rclonefile-darwin-x64"
  },
  "darwin-arm64": {
    local: "rclonefile.darwin-arm64.node",
    module: "rclonefile-darwin-arm64"
  },
  "freebsd-x64": {
    local: "rclonefile.freebsd-x64.node",
    module: "rclonefile-freebsd-x64"
  },
  "linux-x64-musl": {
    local: "rclonefile.linux-x64-musl.node",

    module: "rclonefile-linux-x64-musl"
  },
  "linux-x64": {
    local: "rclonefile.linux-x64-gnu.node",
    module: "rclonefile-linux-x64-gnu"
  },
  "linux-arm64-musl": {
    local: "rclonefile.linux-arm64-musl.node",
    module: "rclonefile-linux-arm64-musl"
  },
  "linux-arm64": {
    local: "rclonefile.linux-arm64-gnu.node",
    module: "rclonefile-linux-arm64-gnu"
  },
  "linux-arm": {
    local: "rclonefile.linux-arm-gnueabihf.node",
    module: "rclonefile-linux-arm-gnueabihf"
  }
};

/**
 *
 * @returns
 */
function getNativeBinding() {
  const { platform, arch } = process;
  let key = `${platform}-${arch}`;
  if (platform === "linux") {
    if (isMusl()) {
      key += "-musl";
    }
  }

  const data = nativeBindingHandlers[key];
  if (data) {
    let req = join(__dirname, data.local);
    if (!existsSync(req)) {
      req = data.module;
    }
    return require(req);
  } else {
    throw new Error(`Unsupported OS: ${platform}, architecture: ${arch}, key: ${key}`);
  }
}

module.exports = getNativeBinding();
