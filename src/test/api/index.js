const path = require("path")
const Mocha = require("mocha")
const glob = require("glob")

async function run() {
	// Create the mocha test
	const mocha = new Mocha({
		ui: "bdd",
		color: true,
		timeout: 60000, // Increased timeout for API operations
	})

	const testsRoot = path.resolve(__dirname, ".")

	try {
		// Find all API test files recursively
		const files = await glob("**/*.test.js", { cwd: testsRoot })

		// Add files to the test suite
		files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)))

		// Run the mocha test
		return new Promise((resolve, reject) => {
			try {
				// Run the tests
				mocha.run((failures) => {
					if (failures > 0) {
						reject(new Error(`${failures} tests failed.`))
					} else {
						resolve()
					}
				})
			} catch (err) {
				reject(err)
			}
		})
	} catch (err) {
		console.error("Failed to run API tests:", err)
		throw err
	}
}

module.exports = { run }
