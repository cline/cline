import { defineConfig } from "@playwright/test"

const isCI = !!process?.env?.CI
const isWindow = process?.platform?.startsWith("win")
const isInteractive = process?.env?.INTERACTIVE_E2E === "true"

const E2E_TEST_CONFIG = defineConfig({
	workers: 1,
	retries: 1,
	forbidOnly: isCI,
	testDir: "src/test/e2e",
	testMatch: /.*\.test\.ts/,
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
			testMatch: /global\.setup\.ts/,
		},
		{
			name: "e2e tests",
			dependencies: ["setup test environment"],
		},
	],
})

const INTERACTIVE_UI_CONFIG = defineConfig({
	workers: 1,
	testDir: "src/test/e2e",
	testMatch: "interactive.ui.ts", // Different pattern to avoid running actual tests
	timeout: 0, // No timeout for interactive sessions
	fullyParallel: false,
	reporter: [["list"]],
	projects: [
		{
			name: "setup test environment",
			testMatch: /global\.setup\.ts/,
		},
		{
			name: "interactive-ui",
			testMatch: "interactive.ui.ts",
			dependencies: ["setup test environment"],
		},
	],
})

export default isInteractive ? INTERACTIVE_UI_CONFIG : E2E_TEST_CONFIG
