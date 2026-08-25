import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.e2e.test.ts"],
		testTimeout: 30_000,
		hookTimeout: 30_000,
		// These e2e files spawn real daemon processes and assert on wall-clock
		// budgets (discovery within 10s, exit within 5s, a 2s shutdown
		// watchdog). Run them one file at a time: in parallel they compete for
		// the runner's cores, and on a 2-core Windows runner the contention
		// alone blew those budgets — singleton.e2e.test.ts holds daemons up for
		// ~15s, which is long enough to starve shutdown.e2e.test.ts into either
		// missing discovery or being forced to exit before its HTTP response
		// flushed.
		fileParallelism: false,
	},
});
