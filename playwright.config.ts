import { defineConfig } from "@playwright/test"

const isGitHubAction = !!process.env.CI

export default defineConfig({
	workers: 1,
	retries: 1,
	testDir: "src/test/e2e",
	timeout: 20000,
	expect: {
		timeout: 20000,
	},
	fullyParallel: true,
	reporter: isGitHubAction ? [["github"], ["list"]] : [["list"]],
	globalSetup: require.resolve("./src/test/e2e/utils/setup"),
	globalTeardown: require.resolve("./src/test/e2e/utils/teardown"),
})
