import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * `@cline/core` publishes from `dist/`, which is not built in every checkout
 * (and would be stale for a testkit that must track the live hub server). The
 * testkit therefore resolves the core hub surface from source; core's own
 * dependencies still resolve from `sdk/packages/core/node_modules`.
 */
const coreHubSrc = fileURLToPath(
	new URL("../core/src/hub/index.ts", import.meta.url),
);

export default defineConfig({
	resolve: {
		alias: [{ find: /^@cline\/core\/hub$/, replacement: coreHubSrc }],
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		// Booting real WS servers plus SQLite-backed schedule services is slower
		// than a pure unit test, and CI runners are noticeably slower still.
		testTimeout: 30_000,
		hookTimeout: 30_000,
		pool: "forks",
		// Fixture writes are shared mutable state; scenarios must not race.
		fileParallelism: false,
	},
});
