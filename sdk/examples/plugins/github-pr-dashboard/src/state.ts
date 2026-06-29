import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { GitHubPrDashboardSnapshot } from "./schema";

export interface GitHubPrDashboardState {
	version: 1;
	lastSnapshotHash?: string;
	lastGeneratedAt?: string;
	lastSnapshot?: GitHubPrDashboardSnapshot;
}

export const EMPTY_GITHUB_PR_DASHBOARD_STATE: GitHubPrDashboardState = {
	version: 1,
};

function dataDirFromEnv(env: NodeJS.ProcessEnv): string {
	return env.CLINE_DATA_DIR?.trim() || join(homedir(), ".cline", "data");
}

export function resolveStatePath(env: NodeJS.ProcessEnv = process.env): string {
	return (
		env.GITHUB_PR_DASHBOARD_STATE_PATH?.trim() ||
		join(dataDirFromEnv(env), "plugins", "github-pr-dashboard", "state.json")
	);
}

function normalizeState(value: unknown): GitHubPrDashboardState {
	if (!value || typeof value !== "object") return { version: 1 };
	const input = value as Partial<GitHubPrDashboardState>;
	return {
		version: 1,
		...(typeof input.lastSnapshotHash === "string"
			? { lastSnapshotHash: input.lastSnapshotHash }
			: {}),
		...(typeof input.lastGeneratedAt === "string"
			? { lastGeneratedAt: input.lastGeneratedAt }
			: {}),
		...(input.lastSnapshot && typeof input.lastSnapshot === "object"
			? { lastSnapshot: input.lastSnapshot }
			: {}),
	};
}

export function readState(path = resolveStatePath()): GitHubPrDashboardState {
	if (!existsSync(path)) return { version: 1 };
	try {
		return normalizeState(JSON.parse(readFileSync(path, "utf8")));
	} catch {
		return { version: 1 };
	}
}

export function writeState(
	state: GitHubPrDashboardState,
	path = resolveStatePath(),
): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(normalizeState(state), null, 2)}\n`);
}
