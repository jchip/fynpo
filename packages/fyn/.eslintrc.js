const { eslintRcNode } = require("@xarc/module-dev");

module.exports = {
  extends: eslintRcNode,
  rules: {
    // fyn is a CLI; console is the intended user-facing output channel
    // (e.g. fyn-global listGlobalPackages / showPathSetup print results and
    // PATH setup instructions directly to the terminal).
    "no-console": "off",
    // Package-manager install/link/update/remove flows are inherently long
    // and branchy; the size/shape limits from the shared config don't fit.
    complexity: "off",
    "max-statements": "off",
    "max-params": "off",
    // Allow non-camelCase object properties for external contracts such as
    // npm's env-var names (npm_package_name, npm_config_*). Identifiers are
    // still required to be camelCase.
    camelcase: ["error", { properties: "never" }]
  }
};
