	
// This file sets up the Mocha global functions for integration tests
const path = require("path")
const fs = require("fs")
const Module = require("module")

// Set up module aliases to handle the dual output structure
const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
	// If we're trying to import from a test file
	if (parent && parent.filename && parent.filename.includes("/out/utils/") && request.startsWith("./")) {
		// Check if the file exists in the out/utils directory
		const basePath = path.dirname(parent.filename)
		const normalPath = path.join(basePath, request)

		// If the file doesn't exist with .js extension, try to find it in out/src/utils
		if (!fs.existsSync(normalPath + ".js")) {
			const projectRoot = path.resolve(__dirname, "../..")
			const alternativePath = path.join(projectRoot, "out/utils", request.substring(2))
			if (fs.existsSync(alternativePath + ".js")) {
				return originalResolveFilename.call(this, alternativePath, parent, isMain, options)
			}
		}
	}

	return originalResolveFilename.call(this, request, parent, isMain, options)
}

// Ensure Mocha globals are available
// This approach works regardless of how Mocha is loaded (directly or via ts-mocha)
if (typeof global.describe !== "function") {
	try {
		// Try to load Mocha directly
		const Mocha = require("mocha")
		const mocha = new Mocha()
		mocha.ui("bdd")

		// If that didn't set up the globals, set them up manually
		if (typeof global.describe !== "function") {
			const mochaInstance = new Mocha()
			mochaInstance.ui("bdd")

			// Extract the context from the root suite
			const context = {}
			mochaInstance.suite.emit("pre-require", context, null, mochaInstance)

			// Copy all test functions to global
			Object.keys(context).forEach((key) => {
				global[key] = context[key]
			})
		}
	} catch (err) {
		console.error("Failed to set up Mocha globals:", err)
		throw err
	}
}

// Verify that the globals are now available
if (typeof global.describe !== "function") {
	throw new Error("Mocha globals are not available after setup")
}
