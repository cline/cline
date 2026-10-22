import { defineConfig } from "@playwright/test"

export default defineConfig({
	testDir: "webview-ui/tests/chat-usability",
	testMatch: "*.pw.ts",
	workers: 1,
	use: {
		baseURL: "http://127.0.0.1:5199",
		viewport: { width: 800, height: 800 },
		launchOptions: process.env.CHROMIUM_EXECUTABLE_PATH
			? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ["--no-sandbox"] }
			: {},
	},
	webServer: {
		command: "npm run dev -- --host 127.0.0.1 --port 5199",
		cwd: "webview-ui",
		url: "http://127.0.0.1:5199/tests/chat-usability/",
		reuseExistingServer: !process.env.CI,
		timeout: 120000,
	},
})
