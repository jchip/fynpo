"use strict";

const mockNpm = require("../fixtures/mock-npm");
const expect = require("chai").expect;
const logger = require("../../lib/logger");
const chalk = require("chalk");

// Skipping this test suite as it's primarily for debugging pacote-jchip vs latest pacote
// add ../pacote-jchip as a dependency and run this test to compare results
describe.skip("pacote-compare", function() {
  logger.setItemType(false);
  chalk.enabled = false;
  let server;

  before(() => {
    return mockNpm({ logLevel: "warn" }).then(s => (server = s));
  });

  after(() => {
    return server.stop();
  });

  beforeEach(() => {
    logger._logLevel = 999;
  });

  it("should compare packument results between jchip/pacote and latest pacote", () => {
    const pacoteJchip = require("pacote-jchip");
    const pacoteLatest = require("pacote");

    const registryUrl = `http://localhost:${server.info.port}`;

    const opts = {
      "full-metadata": true,
      "fetch-retries": 3,
      "cache-policy": "ignore",
      registry: registryUrl
    };

    // Test packages from pkg-a fixture
    const packages = ["mod-a", "mod-b", "mod-c", "mod-d", "mod-e", "mod-err"];

    return Promise.all(
      packages.map(pkgName => {
        let resultJchip;
        let resultLatest;

        return pacoteJchip
          .packument(pkgName, opts)
          .then(result => {
            resultJchip = result;
            console.log(`\n=== ${pkgName} ===`);
            console.log("jchip/pacote result keys:", Object.keys(result));
            console.log("jchip/pacote versions count:", Object.keys(result.versions || {}).length);
            console.log("full packument retrieved", JSON.stringify(result, null, 2));
            return pacoteLatest.packument(pkgName, opts);
          })
          .then(result => {
            resultLatest = result;
            console.log("latest pacote result keys:", Object.keys(result));
            console.log("latest pacote versions count:", Object.keys(result.versions || {}).length);

            // Compare the structure and content
            expect(resultJchip.name).to.equal(resultLatest.name);
            expect(Object.keys(resultJchip.versions)).to.deep.equal(
              Object.keys(resultLatest.versions)
            );

            // Check if both have the same version data
            for (const version of Object.keys(resultJchip.versions)) {
              const jchipVer = resultJchip.versions[version];
              const latestVer = resultLatest.versions[version];

              expect(jchipVer.name).to.equal(latestVer.name);
              expect(jchipVer.version).to.equal(latestVer.version);

              // Compare dependencies if they exist
              if (jchipVer.dependencies) {
                expect(jchipVer.dependencies).to.deep.equal(latestVer.dependencies);
              }
              if (latestVer.dependencies) {
                expect(jchipVer.dependencies).to.deep.equal(latestVer.dependencies);
              }

              // Compare optionalDependencies if they exist
              if (jchipVer.optionalDependencies) {
                expect(jchipVer.optionalDependencies).to.deep.equal(latestVer.optionalDependencies);
              }
              if (latestVer.optionalDependencies) {
                expect(jchipVer.optionalDependencies).to.deep.equal(latestVer.optionalDependencies);
              }
            }

            return { pkgName, jchip: resultJchip, latest: resultLatest };
          });
      })
    ).then(results => {
      console.log(
        "\nComparison successful - both pacote versions return identical results for all packages"
      );
      // Log any differences in metadata keys and full comparison
      results.forEach(({ pkgName, jchip, latest }) => {
        const jchipKeys = Object.keys(jchip);
        const latestKeys = Object.keys(latest);
        const extraInJchip = jchipKeys.filter(k => !latestKeys.includes(k));
        const extraInLatest = latestKeys.filter(k => !jchipKeys.includes(k));

        if (extraInJchip.length > 0 || extraInLatest.length > 0) {
          console.log(`${pkgName} differences:`);
          if (extraInJchip.length > 0) {
            console.log(`  jchip extra keys: ${extraInJchip.join(", ")}`);
          }
          if (extraInLatest.length > 0) {
            console.log(`  latest extra keys: ${extraInLatest.join(", ")}`);
          }
        }

        // Deep compare the full objects
        const jchipClean = JSON.parse(JSON.stringify(jchip));
        const latestClean = JSON.parse(JSON.stringify(latest));

        // Remove differing metadata keys for comparison
        delete jchipClean._cached;
        delete jchipClean._contentLength;
        delete latestClean._contentLength;

        try {
          expect(jchipClean).to.deep.equal(latestClean);
        } catch (e) {
          console.log(`${pkgName} FULL OBJECT DIFFERENCES:`);
          console.log("jchip:", JSON.stringify(jchipClean, null, 2));
          console.log("latest:", JSON.stringify(latestClean, null, 2));
          throw e;
        }
      });
    });
  }).timeout(30000);
});
