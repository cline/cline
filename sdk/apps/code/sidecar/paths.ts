import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { resolveSessionDataDir } from "@clinebot/shared/storage";
import type { JsonRecord } from "./types";

// ---------------------------------------------------------------------------
// Workspace root
// ---------------------------------------------------------------------------

export function resolveWorkspaceRoot(launchCwd: string): string {
	const cwd = resolve(launchCwd);
	try {
		const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		})
			.trim()
			.replace(/[\\/]+$/, "");
		return root || cwd;
	} catch {
		return cwd;
	}
}

// ---------------------------------------------------------------------------
// Shared session data directories
// ---------------------------------------------------------------------------

export function sharedSessionDataDir(): string {
	return process.env.CLINE_SESSION_DATA_DIR?.trim() || resolveSessionDataDir();
}

export function sharedSessionArtifactPath(
	sessionId: string,
	suffix: string,
): string {
	return join(sharedSessionDataDir(), sessionId, `${sessionId}.${suffix}`);
}

export function sharedSessionLogPath(sessionId: string): string {
	return sharedSessionArtifactPath(sessionId, "log");
}

export function sharedSessionMessagesPath(sessionId: string): string {
	return sharedSessionArtifactPath(sessionId, "messages.json");
}

export function sharedSessionMessagesWritePath(sessionId: string): string {
	return sharedSessionMessagesPath(sessionId);
}

// ---------------------------------------------------------------------------
// Tool approval directory (kept for file cleanup compatibility)
// ---------------------------------------------------------------------------

export function toolApprovalDir(): string {
	return (
		process.env.CLINE_TOOL_APPROVAL_DIR?.trim() ||
		join(sharedSessionDataDir(), "tool-approvals")
	);
}

// ---------------------------------------------------------------------------
// MCP settings
// ---------------------------------------------------------------------------

export function resolveMcpSettingsPath(): string {
	return (
		process.env.CLINE_MCP_SETTINGS_PATH?.trim() ||
		join(homedir(), ".cline", "data", "settings", "cline_mcp_settings.json")
	);
}

// ---------------------------------------------------------------------------
// Session log paths (kanban-style)
// ---------------------------------------------------------------------------

function kanbanDataRoot(): string {
	return (
		process.env.CLINE_KANBAN_DATA_DIR?.trim() ||
		join(homedir(), ".cline", "apps", "kanban")
	);
}

export function sessionLogPath(sessionId: string): string {
	return join(kanbanDataRoot(), "sessions", `${sessionId}.jsonl`);
}

// ---------------------------------------------------------------------------
// Session ID helpers
// ---------------------------------------------------------------------------

export function rootSessionIdFrom(sessionId: string): string {
	return sessionId.split("__")[0] || sessionId;
}

// ---------------------------------------------------------------------------
// Artifact discovery
// ---------------------------------------------------------------------------

export function findArtifactUnderDir(
	dir: string,
	fileName: string,
	maxDepth: number,
): string | null {
	if (!existsSync(dir)) {
		return null;
	}
	const stack: Array<{ dir: string; depth: number }> = [{ dir, depth: 0 }];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) {
			break;
		}
		for (const entry of readdirSync(current.dir, { withFileTypes: true })) {
			const path = join(current.dir, entry.name);
			if (entry.isFile() && entry.name === fileName) {
				return path;
			}
			if (entry.isDirectory() && current.depth < maxDepth) {
				stack.push({ dir: path, depth: current.depth + 1 });
			}
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Session manifest read/write
// ---------------------------------------------------------------------------

export function readSessionManifest(sessionId: string): JsonRecord | null {
	const path = join(sharedSessionDataDir(), sessionId, `${sessionId}.json`);
	if (!existsSync(path)) {
		return null;
	}
	try {
		return JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
	} catch {
		return null;
	}
}

export function writeSessionManifest(
	sessionId: string,
	manifest: JsonRecord,
): void {
	const path = join(sharedSessionDataDir(), sessionId, `${sessionId}.json`);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}
