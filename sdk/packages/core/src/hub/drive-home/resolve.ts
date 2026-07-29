/**
 * Resolve `.driveagent/<slug>/` home directories (DRV-DRIVEAGENT-HOME / ARD-0001).
 *
 * First-match-by-slug: workspace tier, then optional user tier under `~/.driveagent/`.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DRIVEAGENT_DIRECTORY_NAME = ".driveagent";
export const DRIVEAGENT_AGENT_YAML = "agent.yaml";
export const DRIVEAGENT_PERMISSIONS_YAML = "permissions.yaml";
export const DRIVEAGENT_ENV_YAML = "env.yaml";

export type DriveagentHomeTier = "workspace" | "user";

export type ResolvedDriveagentHomeDir = {
	readonly path: string;
	readonly tier: DriveagentHomeTier;
};

export function resolveWorkspaceDriveagentHomeDir(
	workspaceRoot: string,
	slug: string,
): string {
	return join(workspaceRoot, DRIVEAGENT_DIRECTORY_NAME, slug);
}

export function resolveUserDriveagentHomeDir(
	slug: string,
	homeDir: string = homedir(),
): string {
	return join(homeDir, DRIVEAGENT_DIRECTORY_NAME, slug);
}

function hasAgentYaml(homeDir: string): boolean {
	return existsSync(join(homeDir, DRIVEAGENT_AGENT_YAML));
}

/**
 * Resolve an on-disk Driveagent home directory for `slug`.
 * Returns null when neither workspace nor user tier has `agent.yaml`.
 */
export function resolveDriveagentHomeDir(input: {
	workspaceRoot: string;
	slug: string;
	/** Override for tests; defaults to `os.homedir()`. */
	userHomeDir?: string;
}): ResolvedDriveagentHomeDir | null {
	const workspacePath = resolveWorkspaceDriveagentHomeDir(
		input.workspaceRoot,
		input.slug,
	);
	if (hasAgentYaml(workspacePath)) {
		return { path: workspacePath, tier: "workspace" };
	}

	const userPath = resolveUserDriveagentHomeDir(
		input.slug,
		input.userHomeDir ?? homedir(),
	);
	if (hasAgentYaml(userPath)) {
		return { path: userPath, tier: "user" };
	}

	return null;
}
