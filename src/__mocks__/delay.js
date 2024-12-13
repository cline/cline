function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = delay;
module.exports.default = delay;