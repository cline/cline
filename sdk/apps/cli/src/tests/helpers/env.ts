// ---------------------------------------------------------------------------
// Environment helpers for test setup.
//
// Usage:
//   test.use({ env: clineEnv("default") });
//   test.use({ env: clineEnv("claude-sonnet-4.6") });
//   test.use({ env: clineEnv("/absolute/path/to/config") });
// ---------------------------------------------------------------------------

import os from "node:os";
import path from "node:path";

export const TEST_SUITE_ROOT = new URL("../", import.meta.url).pathname;

/**
 * Build the process environment for a cline test.
 *
 * @param configDir - Named config under `configs/`, or an absolute path.
 * @param extra     - Additional env vars to merge in (override defaults).
 */
export function clineEnv(
	configDir: string,
	extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
	const clinePath = path.isAbsolute(configDir)
		? configDir
		: path.join(TEST_SUITE_ROOT, "configs", configDir);

	// Determine effective VCR mode: extra overrides > parent env > default "playback"
	const effectiveVcrMode =
		extra.CLINE_VCR ?? process.env.CLINE_VCR ?? "playback";

	// During recording, authenticated configs read real OAuth credentials from
	// ~/.cline/data/settings/providers.json while keeping all other settings
	// (model, provider, global state) from the mock config directory.
	const isRecording = effectiveVcrMode === "record";
	const isAuthenticated = configDir !== "unauthenticated";
	const realProvidersFile =
		isRecording && isAuthenticated
			? path.join(os.homedir(), ".cline", "data", "settings", "providers.json")
			: undefined;

	// Remove CI env var so Ink's `is-in-ci` check doesn't disable interactive
	// rendering. When CI=true (set by GitHub Actions / act), Ink treats the
	// environment as non-interactive and skips rendering to stdout — even
	// inside a real PTY — which causes tui-test traces to be empty.
	//
	// Remove VITEST so the spawned CLI binary doesn't skip initVcr().
	// cli/src/index.ts guards `initVcr` behind `process.env.VITEST !== "true"`,
	// so if the parent vitest process's VITEST=true leaks into the child, VCR
	// recording/playback is silently skipped.
	const { CI: _ci, VITEST: _vitest, ...cleanEnv } = process.env;

	// Only enable VCR when a cassette path is provided (via extra or parent env),
	// otherwise tests without cassettes would trigger a spurious
	// "[VCR] No CLINE_VCR_CASSETTE" warning on every run.
	const hasCassette = !!(
		extra.CLINE_VCR_CASSETTE ?? process.env.CLINE_VCR_CASSETTE
	);
	const vcrDefaults = hasCassette
		? { CLINE_VCR: "playback", CLINE_VCR_FILTER: "" }
		: {};

	// the order of these env vars matter; later ones override earlier ones
	return {
		...vcrDefaults,
		...cleanEnv,
		...(realProvidersFile
			? { CLINE_PROVIDER_SETTINGS_PATH: realProvidersFile }
			: {}),
		CLINE_TELEMETRY_DISABLED: "1",
		CLINE_DIR: clinePath,
		NO_UPDATE_NOTIFIER: "1",
		CLINE_NO_AUTO_UPDATE: "1",
		...extra,
	};
}
