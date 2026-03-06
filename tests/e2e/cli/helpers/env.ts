// ---------------------------------------------------------------------------
// Environment helpers for test setup.
//
// Usage:
//   test.use({ env: clineEnv("default") });
//   test.use({ env: clineEnv("claude-sonnet-4.6") });
//   test.use({ env: clineEnv("/absolute/path/to/config") });
// ---------------------------------------------------------------------------

import path from "path"

const TEST_SUITE_ROOT = new URL("../", import.meta.url).pathname

/**
 * Build the process environment for a cline test.
 *
 * @param configDir - Named config under `configs/`, or an absolute path.
 * @param extra     - Additional env vars to merge in (override defaults).
 */
export function clineEnv(configDir: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	const clinePath = path.isAbsolute(configDir) ? configDir : path.join(TEST_SUITE_ROOT, "configs", configDir)

	return {
		...process.env,
		CLINE_TELEMETRY_DISABLED: "1",
		CLINE_DIR: clinePath,
		NO_UPDATE_NOTIFIER: "1",
		...extra,
	}
}

/**
 * @deprecated Use `clineEnv` instead. Kept for backward compatibility.
 */
export function testEnv(configDir: string): NodeJS.ProcessEnv {
	return clineEnv(configDir)
}
