// Mock implementation of p-limit for Jest tests
// p-limit is a utility for limiting the number of concurrent promises

const pLimit = (concurrency) => {
	// Return a function that just executes the passed function immediately
	// In tests, we don't need actual concurrency limiting
	return (fn) => {
		if (typeof fn === "function") {
			return fn()
		}
		return fn
	}
}

// Set default export
pLimit.default = pLimit

module.exports = pLimit
