import type * as LlmsProviders from "@cline/llms";

/** External tools whose session history Cline can import. */
export const SESSION_IMPORT_TOOLS = [
	"claude-code",
	"codex",
	"opencode",
] as const;

export type SessionImportTool = (typeof SESSION_IMPORT_TOOLS)[number];

export const SESSION_IMPORT_TOOL_LABELS: Record<SessionImportTool, string> = {
	"claude-code": "Claude Code",
	codex: "Codex",
	opencode: "opencode",
};

/**
 * A session found in an external tool's on-disk store, described with just
 * enough metadata to render an import picker. Discovery must stay cheap; the
 * full conversation is only parsed when the session is actually imported.
 */
export interface ImportableSessionSummary {
	tool: SessionImportTool;
	/** Stable identifier within the source tool's store. */
	sourceId: string;
	/** File (or database) the session was discovered in. */
	sourcePath: string;
	title: string;
	/** Original working directory, when the source recorded one. */
	cwd: string;
	startedAtMs: number;
	updatedAtMs: number;
	/** Conversational user/assistant events (not raw store lines). */
	messageCount: number;
	/** First real user prompt, trimmed for display. */
	preview?: string;
	/** Set when a prior import of this source session already exists. */
	alreadyImportedSessionId?: string;
}

/** A source session fully translated to Cline's native message format. */
export interface ConvertedImportedSession {
	tool: SessionImportTool;
	sourceId: string;
	sourcePath: string;
	title: string;
	/** First real user prompt (used for the session's prompt field). */
	prompt?: string;
	provider: string;
	model: string;
	cwd: string;
	gitBranch?: string;
	startedAtMs: number;
	endedAtMs: number;
	messages: LlmsProviders.MessageWithMetadata[];
}

export interface SessionImportAdapter {
	readonly tool: SessionImportTool;
	/** Whether the tool's session store exists on this machine. */
	isInstalled(): boolean;
	discover(): ImportableSessionSummary[];
	/** Throws if the source session cannot be found or parsed. */
	convert(sourceId: string): ConvertedImportedSession;
	/**
	 * Releases per-batch caches (file indexes, database snapshots). Called by
	 * the service after each discover/import batch; adapters stay usable after.
	 */
	dispose?(): void;
}

export interface SessionImportRequest {
	tool: SessionImportTool;
	sourceId: string;
}

export interface SessionImportOptions {
	/**
	 * Cline provider/model the imported sessions should resume with. Opening a
	 * history session adopts the row's provider/model, so without this the
	 * session would try to run on the source tool's provider (openai-native,
	 * or an opencode provider id Cline doesn't know) which the user may never
	 * have configured. Both must be set to take effect; the source tool's own
	 * provider/model are always preserved in metadata.importedFrom and in
	 * per-message modelInfo.
	 */
	provider?: string;
	model?: string;
}

export interface SessionImportResult {
	tool: SessionImportTool;
	sourceId: string;
	ok: boolean;
	/** Cline session id created for this import (on success). */
	sessionId?: string;
	title?: string;
	error?: string;
	/** Set when the source session had already been imported; sessionId is
	 * the existing Cline session and nothing new was written. */
	alreadyImported?: boolean;
}

export function truncateForDisplay(
	value: string | undefined,
	max = 200,
): string | undefined {
	const trimmed = value?.replace(/\s+/g, " ").trim();
	if (!trimmed) return undefined;
	return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}
