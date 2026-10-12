import { homedir } from "node:os";
import { join } from "node:path";

export interface SessionImportPathEnvironment {
	platform: NodeJS.Platform;
	homeDir: string;
	env: Readonly<Record<string, string | undefined>>;
	joinPath: (...paths: string[]) => string;
}

// Adapters resolve defaults synchronously at construction and retain the paths.
const runtimeEnvironment = (): SessionImportPathEnvironment => ({
	platform: process.platform,
	homeDir: homedir(),
	env: process.env,
	joinPath: join,
});

function nonEmpty(value: string | undefined): string | undefined {
	return value?.trim() ? value : undefined;
}

function userHome(environment: SessionImportPathEnvironment): string {
	// Resolve Windows tool stores from the native profile variables explicitly;
	// HOMEDRIVE and HOMEPATH also cover profiles without USERPROFILE.
	if (environment.platform === "win32") {
		const userProfile = nonEmpty(environment.env.USERPROFILE);
		if (userProfile) return userProfile;

		const homeDrive = nonEmpty(environment.env.HOMEDRIVE);
		const homePath = nonEmpty(environment.env.HOMEPATH);
		if (homeDrive && homePath) return `${homeDrive}${homePath}`;
	}
	return environment.homeDir;
}

export function claudeCodeProjectsDir(
	environment = runtimeEnvironment(),
): string {
	const configDir = nonEmpty(environment.env.CLAUDE_CONFIG_DIR);
	return environment.joinPath(
		configDir ?? environment.joinPath(userHome(environment), ".claude"),
		"projects",
	);
}

export function codexHomeDir(environment = runtimeEnvironment()): string {
	return (
		nonEmpty(environment.env.CODEX_HOME) ??
		environment.joinPath(userHome(environment), ".codex")
	);
}

export function opencodeDataDir(environment = runtimeEnvironment()): string {
	const dataHome =
		nonEmpty(environment.env.XDG_DATA_HOME) ??
		environment.joinPath(userHome(environment), ".local", "share");
	return environment.joinPath(dataHome, "opencode");
}

// Design note: the three path helpers below are pure functions of their
// environment (no node:fs), so paths.test.ts can exercise them without a real
// machine. Each returns *candidate* locations; the adapter is responsible for
// probing existence (via existsSync) because "installed" depends on what is
// actually on disk.

/**
 * VS Code "globalStorage" roots for the current platform. Kilo Code ships as a
 * VS Code extension, so its task store lives under the editor's globalStorage.
 * The editor variant that installed it (Code, Cursor, Windsurf, …) is unknown,
 * so we return every well-known root and let the adapter pick the first that
 * holds a Kilo Code store. An explicit KILOCODE_GLOBAL_STORAGE override always
 * wins and short-circuits the scan.
 */
export function vscodeGlobalStorageRoots(
	environment = runtimeEnvironment(),
): string[] {
	const override = nonEmpty(environment.env.KILOCODE_GLOBAL_STORAGE);
	if (override) return [override];

	const editorDirs = [
		"Code",
		"Code - Insiders",
		"VSCodium",
		"Cursor",
		"Windsurf",
		"Code - OSS",
	];
	const roots: string[] = [];
	if (environment.platform === "win32") {
		const appData = nonEmpty(environment.env.APPDATA);
		if (appData) {
			for (const editor of editorDirs) {
				roots.push(
					environment.joinPath(appData, editor, "User", "globalStorage"),
				);
			}
		}
	} else if (environment.platform === "darwin") {
		const support = environment.joinPath(
			userHome(environment),
			"Library",
			"Application Support",
		);
		for (const editor of editorDirs) {
			roots.push(environment.joinPath(support, editor, "User", "globalStorage"));
		}
	} else {
		const config =
			nonEmpty(environment.env.XDG_CONFIG_HOME) ??
			environment.joinPath(userHome(environment), ".config");
		for (const editor of editorDirs) {
			roots.push(environment.joinPath(config, editor, "User", "globalStorage"));
		}
	}
	return roots;
}

/**
 * Candidate directories that hold Kilo Code task folders (each task folder
 * contains api_conversation_history.json). Includes VS Code globalStorage roots
 * and common CLI paths. KILOCODE_TASKS_DIR, when set, pins the location to a
 * single directory.
 */
export function kilocodeTasksDirs(
	environment = runtimeEnvironment(),
): string[] {
	const override = nonEmpty(environment.env.KILOCODE_TASKS_DIR);
	if (override) return [override];

	const candidates: string[] = [];

	// VS Code extension paths (one per editor variant)
	for (const root of vscodeGlobalStorageRoots(environment)) {
		candidates.push(environment.joinPath(root, "kilocode.kilo-code", "tasks"));
	}

	// Common CLI paths
	const home = userHome(environment);
	if (environment.platform === "win32") {
		const appData = nonEmpty(environment.env.APPDATA);
		if (appData) candidates.push(environment.joinPath(appData, "kilocode", "tasks"));
		const localAppData = nonEmpty(environment.env.LOCALAPPDATA);
		if (localAppData) candidates.push(environment.joinPath(localAppData, "kilocode", "tasks"));
	} else {
		candidates.push(environment.joinPath(home, ".kilocode", "tasks"));
		candidates.push(environment.joinPath(home, ".config", "kilocode", "tasks"));
	}

	return candidates;
}

/**
 * Candidate Google Antigravity ("agy") conversation directories. The desktop
 * app and IDE use their own app dirs and the CLI uses antigravity-cli, each
 * writing one SQLite file per conversation under ~/.gemini/<app>/conversations.
 * Returns every candidate so the adapter can merge whichever exist.
 * AGY_CONVERSATIONS_DIR, when set, pins the location to a single directory.
 */
export function agyConversationsDirs(
	environment = runtimeEnvironment(),
): string[] {
	const override = nonEmpty(environment.env.AGY_CONVERSATIONS_DIR);
	if (override) return [override];

	const geminiHome =
		nonEmpty(environment.env.GEMINI_HOME) ??
		environment.joinPath(userHome(environment), ".gemini");
	const appDirs = ["antigravity", "antigravity-ide", "antigravity-cli"];
	return appDirs.map((app) =>
		environment.joinPath(geminiHome, app, "conversations"),
	);
}


