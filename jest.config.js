/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
	transform: {
		"^.+\\.tsx?$": [
			"ts-jest",
			{
				tsconfig: {
					module: "CommonJS",
					moduleResolution: "node",
					esModuleInterop: true,
					allowJs: true,
				},
				diagnostics: false,
				isolatedModules: true,
			},
		],
	},
	testMatch: ["**/__tests__/**/*.test.ts"],
	transformIgnorePatterns: [
		"node_modules/(?!(@modelcontextprotocol|delay|p-wait-for|globby|serialize-error|strip-ansi|default-shell|os-name|strip-bom)/)",
	],
	roots: ["<rootDir>/src", "<rootDir>/webview-ui/src"],
	modulePathIgnorePatterns: [".vscode-test"],
	reporters: [["jest-simple-dot-reporter", {}]],
	setupFiles: [],
}
