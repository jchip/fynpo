module.exports = {
  title: "should include symlinks when FYN_LOCAL_PACK_SYMLINKS is enabled",
  before(cwd, scenarioDir) {
    // Enable symlinks inclusion
    process.env.FYN_LOCAL_PACK_SYMLINKS = "true";
  },
  after() {
    // Clean up env var
    delete process.env.FYN_LOCAL_PACK_SYMLINKS;
  }
};

