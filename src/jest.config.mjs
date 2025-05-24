import process from "node:process"

/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
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
			},
		],
	},
	testMatch: ["**/__tests__/**/*.test.ts"],
	// Platform-specific test configuration
	testPathIgnorePatterns: [
		// Skip platform-specific tests based on environment
		...(process.platform === "win32" ? [".*\\.bash\\.test\\.ts$"] : [".*\\.cmd\\.test\\.ts$"]),
		// PowerShell tests are conditionally skipped in the test files themselves using the setupFilesAfterEnv
	],
	moduleNameMapper: {
		"^vscode$": "<rootDir>/__mocks__/vscode.js",
		"@modelcontextprotocol/sdk$": "<rootDir>/__mocks__/@modelcontextprotocol/sdk/index.js",
		"@modelcontextprotocol/sdk/(.*)": "<rootDir>/__mocks__/@modelcontextprotocol/sdk/$1",
		"^delay$": "<rootDir>/__mocks__/delay.js",
		"^p-wait-for$": "<rootDir>/__mocks__/p-wait-for.js",
		"^p-limit$": "<rootDir>/__mocks__/p-limit.js",
		"^serialize-error$": "<rootDir>/__mocks__/serialize-error.js",
		"^strip-ansi$": "<rootDir>/__mocks__/strip-ansi.js",
		"^default-shell$": "<rootDir>/__mocks__/default-shell.js",
		"^os-name$": "<rootDir>/__mocks__/os-name.js",
		"^strip-bom$": "<rootDir>/__mocks__/strip-bom.js",
	},
	transformIgnorePatterns: [
		"node_modules/(?!(@modelcontextprotocol|delay|p-wait-for|serialize-error|strip-ansi|default-shell|os-name|strip-bom)/)",
	],
	roots: ["<rootDir>"],
	modulePathIgnorePatterns: ["dist", "out"],
	reporters: [["jest-simple-dot-reporter", {}]],
	setupFiles: ["<rootDir>/__mocks__/jest.setup.ts"],
	setupFilesAfterEnv: ["<rootDir>/integrations/terminal/__tests__/setupTerminalTests.ts"],
}
