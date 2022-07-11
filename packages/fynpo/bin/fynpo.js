#!/usr/bin/env node

function load() {
  let dist;

  try {
    dist = require("../lib/index");
    console.log(`
    fynpo loaded from transpiled source instead of webpack bundled source
`);
  } catch (err) {
    dist = require("../dist/bundle");
  }

  return dist;
}

load().fynpoMain();
