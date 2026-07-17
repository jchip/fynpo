"use strict";

const assert = require("assert").strict;
const Fs = require("fs");
const Path = require("path");
const { assertProjected, projectionDir } = require("../assertions");

function replaceAtomically(file, content) {
  const temporary = `${file}.fyn-test-${process.pid}`;
  Fs.writeFileSync(temporary, content);
  Fs.renameSync(temporary, file);
}

module.exports = {
  title: "should expose excluded local source as a live directory link",
  before(cwd, scenarioDir) {
    Fs.rmSync(Path.join(cwd, "_fyn"), { recursive: true, force: true });
    Fs.rmSync(Path.join(scenarioDir, "producer", "package-fyn.json"), { force: true });
  },
  verify(cwd, scenarioDir) {
    assertProjected(cwd, scenarioDir);

    const producerFile = Path.join(scenarioDir, "producer", "src", "value.js");
    const projectedFile = Path.join(projectionDir(cwd), "value.js");
    const original = Fs.readFileSync(producerFile, "utf8");
    const changed = `module.exports = "changed without a watcher";\n`;

    try {
      replaceAtomically(producerFile, changed);
      assert.equal(Fs.readFileSync(projectedFile, "utf8"), changed);

      const addedProducerFile = Path.join(Path.dirname(producerFile), "added.js");
      const addedProjectedFile = Path.join(Path.dirname(projectedFile), "added.js");
      Fs.writeFileSync(addedProducerFile, "module.exports = 'added';\n");
      assert.equal(Fs.readFileSync(addedProjectedFile, "utf8"), "module.exports = 'added';\n");
      Fs.unlinkSync(addedProducerFile);
      assert.equal(Fs.existsSync(addedProjectedFile), false);
    } finally {
      replaceAtomically(producerFile, original);
      Fs.rmSync(Path.join(Path.dirname(producerFile), "added.js"), { force: true });
    }
  }
};
