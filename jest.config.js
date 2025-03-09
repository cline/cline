module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	transform: {
		"^.+\\.tsx?$": [
			"ts-jest",
			{
				useESM: true,
			},
		],
	},
	moduleNameMapper: {
		"^vscode$": "<rootDir>/node_modules/@types/vscode/index.d.ts",
	},
	// Handle ES modules
	extensionsToTreatAsEsm: [".ts", ".tsx"],
	moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
	// Transform node_modules that use ESM
	transformIgnorePatterns: ["<rootDir>/.vscode-test/", "/node_modules/(?!(strip-ansi|ansi-regex)/)"],
}
