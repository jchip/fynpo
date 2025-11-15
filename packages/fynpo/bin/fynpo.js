#!/usr/bin/env node

function load() {
  let dist;

  try {
    dist = require("../src/index.ts");
    console.log(`
fynpo loaded from typescript source instead of webpack bundled source
`);
  } catch (err) {
    dist = require("../dist/bundle");
  }

  return dist;
}

async function main() {
  try {
    await load().fynpoMain();
  } catch (err) {
    process.exit(1);
  }
}

main();