module.exports = {
  title: "should exclude symlinks by default when linking local package",
  before(cwd, scenarioDir) {
    // Set up: ensure symlinks are excluded (default behavior)
    delete process.env.FYN_LOCAL_PACK_SYMLINKS;
  }
};

