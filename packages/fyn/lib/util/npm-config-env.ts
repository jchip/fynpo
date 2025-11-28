// @ts-nocheck
"use strict";

const { makeNpmEnv } = require("./make-npm-env");

/*
 * set all npmrc options into env with npm_config_ prefix
 */

function npmConfigEnv(data, config, env) {
  return makeNpmEnv(data, { config: config }, undefined, env);
}

module.exports = npmConfigEnv;