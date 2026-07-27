import os from "node:os"
import path from "node:path"

/** Subfolder of the Cline home directory that holds the data directory. */
export const SETTINGS_SUBFOLDER = "data"

export interface ClineDataDirOptions {
	/** Explicit data directory. Wins over every other source. */
	dataDir?: string
	/** Explicit Cline home directory; the data directory is `<clineDir>/data`. */
	clineDir?: string
}

/**
 * Resolve the Cline data directory — the one directory that holds
 * `globalState.json`, `secrets.json` and `settings/providers.json`.
 *
 * Every store the extension owns must resolve through here. The extension's
 * own state used to honour only `CLINE_DIR` while the SDK adapter and
 * `@cline/shared` honour `CLINE_DATA_DIR`, so setting `CLINE_DATA_DIR` alone
 * split provider state across two directories: the SDK wrote `providers.json`
 * under `CLINE_DATA_DIR` while the extension kept reading and writing
 * `~/.cline/data/globalState.json`. The stores then disagreed about which
 * provider was selected, and secrets entered in one data directory leaked into
 * sessions run from another.
 *
 * Precedence matches `resolveClineDataDir` in `@cline/shared`, with explicit
 * options taking priority over the environment so callers that isolate
 * themselves (tests, JetBrains) are never overridden by ambient env vars.
 */
export function resolveClineDataDir(opts: ClineDataDirOptions = {}): string {
	const explicitDataDir = opts.dataDir?.trim()
	if (explicitDataDir) {
		return explicitDataDir
	}

	const explicitClineDir = opts.clineDir?.trim()
	if (explicitClineDir) {
		return path.join(explicitClineDir, SETTINGS_SUBFOLDER)
	}

	const envDataDir = process.env.CLINE_DATA_DIR?.trim()
	if (envDataDir) {
		return envDataDir
	}

	const envClineDir = process.env.CLINE_DIR?.trim()
	return path.join(envClineDir || path.join(os.homedir(), ".cline"), SETTINGS_SUBFOLDER)
}
