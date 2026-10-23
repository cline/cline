import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * `@cline/hub-testkit` ships TypeScript sources and imports the live hub server
 * from `@cline/core/hub`, which resolves to a `dist/` that is not built in every
 * checkout. Mirror the alias the testkit uses in its own vitest config so the
 * integration suite resolves the core hub from source.
 */
const coreHubSrc = fileURLToPath(
	new URL("../../sdk/packages/core/src/hub/index.ts", import.meta.url).href,
);

/**
 * The on-disk pairing store the hub daemon and `cline hub share` share. The
 * pairing integration suite writes an offer with it, exactly as the CLI does.
 */
const corePairingSrc = fileURLToPath(
	new URL("../../sdk/packages/core/src/hub/pairing/index.ts", import.meta.url)
		.href,
);

/**
 * Same problem for the device-auth entry the cloud auth store imports: without
 * this alias it resolves to the gitignored `dist/`, so the suite would silently
 * require a prior `build:sdk`.
 */
const coreAuthDeviceSrc = fileURLToPath(
	new URL(
		"../../sdk/packages/core/src/auth/cline-device-entry.ts",
		import.meta.url,
	).href,
);

// The `@/*` tsconfig path alias, mirrored for vitest so the UI kit (which
// imports `@/theme/*`, `@/session`) resolves under the render smoke tests.
const srcRoot = fileURLToPath(new URL("./src", import.meta.url).href);

// Pure-TS suites (token pipeline, config, session core) plus the UI kit render
// smoke tests. The latter run in Node via `react-test-renderer` with every
// native module mocked in `src/ui/__testing__/setup.ts`.
export default defineConfig({
	resolve: {
		alias: [
			{ find: /^@cline\/core\/hub\/pairing$/, replacement: corePairingSrc },
			{ find: /^@cline\/core\/hub$/, replacement: coreHubSrc },
			{
				find: /^@cline\/core\/auth\/cline-device$/,
				replacement: coreAuthDeviceSrc,
			},
			{ find: /^@\//, replacement: `${srcRoot}/` },
		],
	},
	test: {
		name: "mobile",
		environment: "node",
		include: ["scripts/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
		setupFiles: ["./src/ui/__testing__/setup.ts"],
		// Integration tests boot a real hub WebSocket server backed by SQLite
		// schedule services, which is slower than a pure unit test.
		testTimeout: 30_000,
		hookTimeout: 30_000,
		pool: "forks",
	},
});
