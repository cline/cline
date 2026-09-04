import { homedir } from "node:os";
import { join } from "node:path";

export interface SessionImportPathEnvironment {
	platform: NodeJS.Platform;
	homeDir: string;
	env: Readonly<Record<string, string | undefined>>;
	joinPath: (...paths: string[]) => string;
}

const runtimeEnvironment = (): SessionImportPathEnvironment => ({
	platform: process.platform,
	homeDir: homedir(),
	env: process.env,
	joinPath: join,
});

function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
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
