import { FynpoDepGraph } from "./fynpo-dep-graph";
import Fs from "fs";
import Path from "path";
import _ from "lodash";

const readFynpoData = async (cwd) => {
  try {
    const data = Fs.readFileSync(Path.join(cwd, ".fynpo-data.json"), "utf-8");
    return JSON.parse(data);
  } catch (_err) {
    return { indirects: {} };
  }
};

async function testRead() {
  const graph = new FynpoDepGraph({
    cwd: process.cwd(),
    patterns: ["components/*", "packages/*"],
  });

  await graph.resolve();

  const fynpoData = await readFynpoData(process.cwd());
  if (!_.isEmpty(fynpoData.indirects)) {
    _.each(fynpoData.indirects, (relations) => {
      graph.addDepRelations(relations);
    });
    graph.updateDepMap();
  }

  console.log(graph.packages.byPath);

  const topo = graph.getTopoSortPackagePaths();

  console.log(topo);
}

testRead();
