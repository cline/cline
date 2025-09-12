const tsConfigPaths = require("tsconfig-paths")
const fs = require("fs")
const path = require("path")
const Module = require("module")

const baseUrl = path.resolve(__dirname)

// Load the main tsconfig.json for path mappings
const tsConfig = JSON.parse(fs.readFileSync(path.join(baseUrl, "tsconfig.json"), "utf-8"))

// Register path mappings for TypeScript source files (not compiled)
// This allows @utils/shell, @core/*, etc. to resolve correctly for integration tests
tsConfigPaths.register({
	baseUrl: baseUrl,
	paths: tsConfig.compilerOptions.paths,
})

// Mock the @google/genai module to avoid ESM compatibility issues in tests
// The module is ES6 only, but the integration tests need CommonJS compatibility.
const originalRequire = Module.prototype.require
Module.prototype.require = function (id) {
	// Intercept requires for @google/genai
	if (id === "@google/genai") {
		// Return a mock instead of the actual module
		return {
			GoogleGenerativeAI: class MockGoogleGenerativeAI {
				constructor() {}
				getGenerativeModel() {
					return {
						generateContentStream: async function* () {
							yield { text: () => "mock response" }
						},
					}
				}
			},
		}
	}
	return originalRequire.call(this, id)
}
