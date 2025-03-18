const path = require("path")
const { runTests } = require("@vscode/test-electron")

async function main() {
	try {
		// The folder containing the Extension Manifest package.json
		const extensionDevelopmentPath = path.resolve(__dirname, "../../")

		// The path to the extension test script
		const extensionTestsPath = path.resolve(__dirname, "./suite/index")

		// Download VS Code, unzip it and run the integration test
		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs: ["--disable-extensions"],
		})
	} catch (err) {
		console.error("Failed to run tests", err)
		process.exit(1)
	}
}

main()
