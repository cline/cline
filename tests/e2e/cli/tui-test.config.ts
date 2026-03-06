import { defineConfig } from "@microsoft/tui-test"

export default defineConfig({
	retries: 1,
	trace: true,
	traceFolder: "./tui-traces",
	testMatch: "./**/*.test.ts",
	timeout: 30_000,
})
