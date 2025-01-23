import { resolve as _resolve } from "path"
import Mocha from "mocha"
import glob from "glob"

async function run() {
	// Create the mocha test
	const mocha = new Mocha({
		ui: "bdd",
		color: true,
		timeout: 60000, // Increased timeout for extension operations
	})

	const testsRoot = _resolve(__dirname, ".")

	try {
		// Find all test files
		const files = await glob("*.test.js", { cwd: testsRoot })

		// Add files to the test suite
		files.forEach((f) => mocha.addFile(_resolve(testsRoot, f)))

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
		console.error("Failed to run tests:", err)
		throw err
	}
}

export default { run }
