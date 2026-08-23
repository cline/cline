import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		exclude: ["src/**/*.e2e.test.ts"],
		// Process, Git, and SQLite integration coverage shares this suite with
		// pure unit tests. Windows hosted runners regularly exceed Vitest's 5s
		// default while starting those processes, so retain a bounded but realistic
		// budget and reduce Windows CI contention.
		// windows-latest runners are 2-core and spawn forks slowly; the hub
		// suites additionally start real servers and take SQLite locks. These
		// budgets guard against hangs, they are not timing assertions, so give
		// them room rather than failing publishes on runner speed.
		testTimeout: 20_000,
		hookTimeout: 25_000,
		pool: "forks",
		...(process.env.CI && process.platform === "win32"
			? {
					// The full core suite can exhaust a hosted Windows runner when two
					// fork workers overlap process-heavy and SQLite-heavy test files.
					// Run it serially there to prevent unexplained worker termination.
					fileParallelism: false,
					maxWorkers: 1,
				}
			: {}),
	},
});
