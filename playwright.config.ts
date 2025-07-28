import { defineConfig } from "@playwright/test"

const isGitHubAction = !!process?.env?.CI
const isWindow = process?.platform?.startsWith("win")

const DEFAULT_TIMEOUT = isWindow ? 40000 : 20000

export default defineConfig({
	workers: 1,
	retries: 1,
	testDir: "src/test/e2e",
	timeout: DEFAULT_TIMEOUT,
	expect: {
		timeout: DEFAULT_TIMEOUT,
	},
	fullyParallel: true,
	reporter: isGitHubAction ? [["github"], ["list"]] : [["list"]],
	globalSetup: require.resolve("./src/test/e2e/utils/setup"),
	globalTeardown: require.resolve("./src/test/e2e/utils/teardown"),
})
