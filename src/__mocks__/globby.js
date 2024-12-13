function globby(patterns, options) {
  return Promise.resolve([]);
}

globby.sync = function(patterns, options) {
  return [];
};

module.exports = globby;
module.exports.default = globby;