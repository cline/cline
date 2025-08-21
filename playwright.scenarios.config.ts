import { defineConfig } from "@playwright/test"

const isCI = !!process?.env?.CI
const isWindow = process?.platform?.startsWith("win")

export default defineConfig({
	workers: 1,
	retries: 1,
	forbidOnly: isCI,
	// Point to scenarios directory
	testDir: "src/test/scenarios",
	// Include all .ts in scenarios (we add a local global.setup.ts here)
	testMatch: /.*\.ts/,
	timeout: isCI || isWindow ? 40000 : 20000,
	expect: {
		timeout: isCI || isWindow ? 5000 : 2000,
	},
	fullyParallel: true,
	reporter: isCI ? [["github"], ["list"]] : [["list"]],
	use: {
		video: "retain-on-failure",
	},
	projects: [
		{
			name: "setup test environment",
			// Reuse E2E setup file to avoid duplication
			testDir: "src/test/e2e/utils",
			testMatch: /global\.setup\.ts/,
		},
		{
			name: "scenario tests",
			dependencies: ["setup test environment"],
		},
	],
})
