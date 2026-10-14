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
					// Two workers, not one: serializing the whole suite here cost ~3
					// minutes of Windows CI per run. The worker terminations that
					// motivated serializing were timing fragility in the hub suites
					// (a daemon shutdown that could exit before its HTTP response
					// flushed, plus hang guards tight enough to trip on runner speed),
					// which are fixed at the source rather than papered over here.
					maxWorkers: 2,
				}
			: {}),
	},
});
