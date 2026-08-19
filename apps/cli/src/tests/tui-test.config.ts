import { defineConfig } from "@microsoft/tui-test";

export default defineConfig({
	retries: 0,
	workers: 4,
	trace: true,
	traceFolder: "./tui-traces",
	testMatch: "./**/*.test.ts",
	timeout: 60_000,
});
