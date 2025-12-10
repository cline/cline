const tsConfigPaths = require("tsconfig-paths")
const fs = require("fs")
const path = require("path")
const Module = require("module")

const baseUrl = path.resolve(__dirname)

const tsConfig = JSON.parse(fs.readFileSync(path.join(baseUrl, "tsconfig.json"), "utf-8"))

/**
 * The aliases point towards the `src` directory.
 * However, `tsc` doesn't compile paths by itself
 * (https://www.typescriptlang.org/docs/handbook/modules/reference.html#paths-does-not-affect-emit)
 * So we need to use tsconfig-paths to resolve the aliases when running tests,
 * but pointing to `out` instead.
 */
const outPaths = {}
Object.keys(tsConfig.compilerOptions.paths).forEach((key) => {
	const value = tsConfig.compilerOptions.paths[key]
	outPaths[key] = value.map((path) => path.replace("src", "out/src"))
})

tsConfigPaths.register({
	baseUrl: baseUrl,
	paths: outPaths,
})

// Mock the @google/genai module to avoid ESM compatibility issues in tests
// The module is ES6 only, but the integration tests are compiled to commonJS.
const originalRequire = Module.prototype.require
Module.prototype.require = function (id) {
	// Intercept requires for @google/genai
	if (id === "@google/genai") {
		// Return the mock instead
		const mockPath = path.join(baseUrl, "out/src/core/api/providers/gemini-mock.test.js")
		return originalRequire.call(this, mockPath)
	}
	return originalRequire.call(this, id)
}
