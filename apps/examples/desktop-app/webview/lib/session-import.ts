/**
 * Wire types for the sidecar's session-import commands
 * (list_importable_sessions / import_sessions). Mirrors
 * sdk/packages/core/src/services/session-import/types.ts — kept as a local
 * copy so the client bundle never imports node-only core code.
 */

export type SessionImportTool = "claude-code" | "codex" | "opencode";

export const SESSION_IMPORT_TOOL_ORDER: SessionImportTool[] = [
	"claude-code",
	"codex",
	"opencode",
];

export const SESSION_IMPORT_TOOL_LABELS: Record<SessionImportTool, string> = {
	"claude-code": "Claude Code",
	codex: "Codex",
	opencode: "opencode",
};

export interface ImportableSession {
	tool: SessionImportTool;
	sourceId: string;
	sourcePath: string;
	title: string;
	cwd: string;
	startedAtMs: number;
	updatedAtMs: number;
	messageCount: number;
	preview?: string;
	alreadyImportedSessionId?: string;
}

export interface ListImportableSessionsResponse {
	installedTools: SessionImportTool[];
	sessions: ImportableSession[];
}

export interface SessionImportResult {
	tool: SessionImportTool;
	sourceId: string;
	ok: boolean;
	sessionId?: string;
	title?: string;
	error?: string;
	/** The source was already imported; sessionId is the existing session. */
	alreadyImported?: boolean;
}

export interface SessionImportProgressEvent {
	index: number;
	total: number;
	result: SessionImportResult;
}

export function importSelectionKey(tool: string, sourceId: string): string {
	return `${tool}:${sourceId}`;
}
