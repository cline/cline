import { defineConfig } from "@playwright/test"

const isCI = !!process?.env?.CI
const isWindow = process?.platform?.startsWith("win")

export default defineConfig({
	workers: 1,
	retries: 1,
	testDir: "src/test/e2e",
	timeout: isCI || isWindow ? 40000 : 20000,
	expect: {
		timeout: isCI || isWindow ? 5000 : 2000,
	},
	fullyParallel: true,
	reporter: isCI ? [["github"], ["list"]] : [["list"]],
	globalSetup: require.resolve("./src/test/e2e/utils/setup"),
	globalTeardown: require.resolve("./src/test/e2e/utils/teardown"),
})
