import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	CACHE_DIR,
	CURSOR_FILE,
	DATA_DIR_SEGMENTS,
	DATA_SUBDIR,
	DEFAULT_CLINE_HOME,
	LABELS_FILE,
	PLANNER_LEDGER_FILE,
	PRIVATE_FILE_MODE,
	SESSIONS_DIR,
	SETTINGS_FILE,
	STATUS_DB_FILE,
} from "../config";

export type NextTurnPaths = {
	root: string;
	settings: string;
	cursor: string;
	labels: string;
	statusDb: string;
	cache: string;
	sessions: string;
	plannerLedger: string;
};

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Cline's data directory, resolved the way `@cline/shared/storage`'s
 * `resolveClineDataDir` does: `CLINE_DATA_DIR`, else `CLINE_DIR` (or
 * `~/.cline`) plus `data`. Mirrored rather than imported so loading the plugin
 * does not pull `@cline/core` into the sandbox before the first hook needs it.
 */
export function resolveClineDataDir(
	env: Env = process.env,
	home: string = homedir(),
): string {
	const dataDir = env.CLINE_DATA_DIR?.trim();
	if (dataDir) return dataDir;
	const clineDir = env.CLINE_DIR?.trim() || join(home, DEFAULT_CLINE_HOME);
	return join(clineDir, DATA_SUBDIR);
}

/** Where Next Turn keeps its state. Nothing is created until written. */
export function nextTurnPaths(
	dataDir: string = resolveClineDataDir(),
): NextTurnPaths {
	const root = join(dataDir, ...DATA_DIR_SEGMENTS);
	return {
		root,
		settings: join(root, SETTINGS_FILE),
		cursor: join(root, CURSOR_FILE),
		labels: join(root, LABELS_FILE),
		statusDb: join(root, STATUS_DB_FILE),
		cache: join(root, CACHE_DIR),
		sessions: join(root, SESSIONS_DIR),
		plannerLedger: join(root, PLANNER_LEDGER_FILE),
	};
}

/**
 * Write a file so a reader never sees half of it: write a sibling, then
 * rename over the target. The desktop and the CLI read the same settings file.
 */
export function writeFileAtomic(path: string, contents: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temp, contents, { mode: PRIVATE_FILE_MODE });
	renameSync(temp, path);
}
