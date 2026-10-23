import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The relayed-real-session test drives `startTestHub`, which imports
 * `@cline/core/hub`. Core publishes from `dist/`, which is not built in every
 * checkout, so resolve the hub surface from source exactly as
 * `@cline/hub-testkit` does.
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
		// Real WS servers (relay + hub) plus SQLite-backed schedule services.
		testTimeout: 30_000,
		hookTimeout: 30_000,
		pool: "forks",
	},
});
