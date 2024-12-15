function pWaitFor(condition, options = {}) {
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (condition()) {
        clearInterval(interval);
        resolve();
      }
    }, options.interval || 20);

    if (options.timeout) {
      setTimeout(() => {
        clearInterval(interval);
        reject(new Error('Timed out'));
      }, options.timeout);
    }
  });
}

module.exports = pWaitFor;
module.exports.default = pWaitFor;