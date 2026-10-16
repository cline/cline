import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: "http://127.0.0.1:3125",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
		...devices["Desktop Chrome"],
	},
	webServer: {
		command: "bun run dev:headless",
		url: "http://127.0.0.1:3125",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
