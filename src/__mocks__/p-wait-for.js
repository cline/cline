function pWaitFor(condition, options = {}) {
	return new Promise((resolve, reject) => {
		let timeout

		const interval = setInterval(() => {
			if (condition()) {
				if (timeout) {
					clearTimeout(timeout)
				}

				clearInterval(interval)
				resolve()
			}
		}, options.interval || 20)

		if (options.timeout) {
			timeout = setTimeout(() => {
				clearInterval(interval)
				reject(new Error("Timed out"))
			}, options.timeout)
		}
	})
}

module.exports = pWaitFor
module.exports.default = pWaitFor
