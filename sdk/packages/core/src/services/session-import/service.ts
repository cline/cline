import { nanoid } from "nanoid";
import type { UnifiedSessionPersistenceService } from "../../session/services/persistence-service";
import { SessionSource } from "../../types/common";
import { ensureChatWorkspace } from "../workspace/chat-workspace";
import { ClaudeCodeImportAdapter } from "./claude-code";
import { CodexImportAdapter } from "./codex";
import { OpencodeImportAdapter } from "./opencode";
import { sanitizeImportedMessages } from "./sanitize";
import type {
	ConvertedImportedSession,
	ImportableSessionSummary,
	SessionImportAdapter,
	SessionImportOptions,
	SessionImportRequest,
	SessionImportResult,
	SessionImportTool,
} from "./types";

export interface ImportedFromMetadata {
	tool: SessionImportTool;
	sourceSessionId: string;
	sourcePath: string;
	importedAt: string;
	/** Provider/model the source tool ran the session on. */
	sourceProvider?: string;
	sourceModel?: string;
}

export function readImportedFromMetadata(
	metadata: Record<string, unknown> | null | undefined,
): ImportedFromMetadata | undefined {
	const value = metadata?.importedFrom;
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (
		typeof record.tool !== "string" ||
		typeof record.sourceSessionId !== "string"
	) {
		return undefined;
	}
	return {
		tool: record.tool as SessionImportTool,
		sourceSessionId: record.sourceSessionId,
		sourcePath: typeof record.sourcePath === "string" ? record.sourcePath : "",
		importedAt: typeof record.importedAt === "string" ? record.importedAt : "",
	};
}

/**
 * Imports currently being written, keyed by source. Each import_sessions
 * request builds its own service and snapshots the existing markers once,
 * so two overlapping requests for one source (a second window, a
 * double-fired command) would otherwise both pass the dedupe check and
 * persist two sessions. The later caller waits on the first write instead.
 */
const inFlightImports = new Map<string, Promise<SessionImportResult>>();

function importKey(tool: string, sourceId: string): string {
	return `${tool}:${sourceId}`;
}

export class SessionImportService {
	private readonly adapters: SessionImportAdapter[];

	constructor(
		private readonly sessions: UnifiedSessionPersistenceService,
		adapters?: SessionImportAdapter[],
	) {
		this.adapters = adapters ?? [
			new ClaudeCodeImportAdapter(),
			new CodexImportAdapter(),
			new OpencodeImportAdapter(),
		];
	}

	installedTools(): SessionImportTool[] {
		return this.adapters
			.filter((adapter) => {
				try {
					return adapter.isInstalled();
				} catch {
					return false;
				}
			})
			.map((adapter) => adapter.tool);
	}

	/**
	 * `tool:sourceId` → existing Cline session id, from prior imports. Reads
	 * every row's metadata (not the 2000-row listSessions window) so a marker
	 * on an old session still prevents a duplicate.
	 */
	private async existingImports(): Promise<Map<string, string>> {
		const existing = new Map<string, string>();
		try {
			for (const row of await this.sessions.listSessionMetadata()) {
				const imported = readImportedFromMetadata(row.metadata);
				if (imported) {
					existing.set(
						importKey(imported.tool, imported.sourceSessionId),
						row.sessionId,
					);
				}
			}
		} catch {
			// Dedup markers are a convenience; discovery still works without them.
		}
		return existing;
	}

	private disposeAdapters(): void {
		for (const adapter of this.adapters) {
			try {
				adapter.dispose?.();
			} catch {
				// Cache cleanup is best-effort.
			}
		}
	}

	async discover(): Promise<ImportableSessionSummary[]> {
		const existing = await this.existingImports();
		const out: ImportableSessionSummary[] = [];
		try {
			for (const adapter of this.adapters) {
				try {
					if (!adapter.isInstalled()) continue;
					for (const summary of adapter.discover()) {
						const alreadyImportedSessionId = existing.get(
							importKey(summary.tool, summary.sourceId),
						);
						out.push(
							alreadyImportedSessionId
								? { ...summary, alreadyImportedSessionId }
								: summary,
						);
					}
				} catch {
					// One unreadable store must not hide the other tools' sessions.
				}
			}
		} finally {
			this.disposeAdapters();
		}
		out.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
		return out;
	}

	async importOne(
		request: SessionImportRequest,
		options: SessionImportOptions = {},
	): Promise<SessionImportResult> {
		const [result] = await this.importMany([request], undefined, options);
		return result;
	}

	private async importOneUnmanaged(
		request: SessionImportRequest,
		options: SessionImportOptions,
		existing: Map<string, string>,
	): Promise<SessionImportResult> {
		const adapter = this.adapters.find(
			(candidate) => candidate.tool === request.tool,
		);
		if (!adapter) {
			return {
				tool: request.tool,
				sourceId: request.sourceId,
				ok: false,
				error: `No importer for tool "${request.tool}"`,
			};
		}
		// Idempotency at import time, not only at discovery: a stale picker or
		// a repeated request must never produce a second copy.
		const existingSessionId = existing.get(
			importKey(request.tool, request.sourceId),
		);
		if (existingSessionId) {
			return {
				tool: request.tool,
				sourceId: request.sourceId,
				ok: true,
				sessionId: existingSessionId,
				alreadyImported: true,
			};
		}
		const key = importKey(request.tool, request.sourceId);
		const inFlight = inFlightImports.get(key);
		if (inFlight) {
			const first = await inFlight;
			if (first.ok && first.sessionId) {
				existing.set(key, first.sessionId);
				return {
					tool: request.tool,
					sourceId: request.sourceId,
					ok: true,
					sessionId: first.sessionId,
					alreadyImported: true,
				};
			}
			return { ...first, tool: request.tool, sourceId: request.sourceId };
		}
		const work = this.importFresh(adapter, request, options);
		inFlightImports.set(key, work);
		try {
			const result = await work;
			if (result.ok && result.sessionId) existing.set(key, result.sessionId);
			return result;
		} finally {
			inFlightImports.delete(key);
		}
	}

	private async importFresh(
		adapter: SessionImportAdapter,
		request: SessionImportRequest,
		options: SessionImportOptions,
	): Promise<SessionImportResult> {
		try {
			const converted = adapter.convert(request.sourceId);
			const sessionId = await this.persistConverted(converted, options);
			return {
				tool: request.tool,
				sourceId: request.sourceId,
				ok: true,
				sessionId,
				title: converted.title,
			};
		} catch (error) {
			return {
				tool: request.tool,
				sourceId: request.sourceId,
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async importMany(
		requests: SessionImportRequest[],
		onProgress?: (result: SessionImportResult, index: number) => void,
		options: SessionImportOptions = {},
	): Promise<SessionImportResult[]> {
		const results: SessionImportResult[] = [];
		const existing = await this.existingImports();
		try {
			for (const [index, request] of requests.entries()) {
				// Per-session transactional: one bad source session fails one
				// item. Adapter caches (file indexes, db snapshots) live for the
				// whole batch and are released once at the end.
				const result = await this.importOneUnmanaged(
					request,
					options,
					existing,
				);
				results.push(result);
				onProgress?.(result, index);
			}
		} finally {
			this.disposeAdapters();
		}
		return results;
	}

	private async persistConverted(
		converted: ConvertedImportedSession,
		options: SessionImportOptions,
	): Promise<string> {
		const messages = sanitizeImportedMessages(converted.messages);
		if (messages.length === 0) {
			throw new Error("Session has no importable messages");
		}

		// Empty cwd/workspace fails manifest validation and history filters;
		// sessions whose original directory is unknown live in the shared chat
		// workspace, exactly like Cline's own project-less sessions.
		let cwd = converted.cwd.trim();
		if (!cwd) {
			cwd = await ensureChatWorkspace();
		}

		// History sorts by the epoch prefix baked into the session id, so an
		// imported session keeps its original chronology.
		const startedAtMs = Number.isFinite(converted.startedAtMs)
			? converted.startedAtMs
			: Date.now();
		const sessionId = `${startedAtMs}_${nanoid(5)}`;

		// Resume adopts the row's provider/model, so stamp what the user will
		// actually run on; both halves must be present to avoid pairing a
		// Cline provider with a foreign model id.
		const resumeProvider = options.provider?.trim();
		const resumeModel = options.model?.trim();
		const useResumeTarget = Boolean(resumeProvider && resumeModel);

		const endedAtMs = Number.isFinite(converted.endedAtMs)
			? converted.endedAtMs
			: startedAtMs;
		const baseMetadata: Record<string, unknown> = {
			title: converted.title,
			...(converted.gitBranch ? { git: { branch: converted.gitBranch } } : {}),
		};

		// Created already completed: an imported session is history from
		// birth, and a transient running/pid-0 row is exactly what the
		// stale-session reconciler — running in the hub daemon against the
		// same DB — would flip to failed mid-import. Creation sits inside the
		// rollback: it upserts the row before writing the artifact files, so a
		// failed file write must not leave a completed row with no transcript.
		try {
			await this.sessions.createRootSessionWithArtifacts({
				sessionId,
				source: SessionSource.DESKTOP,
				pid: 0,
				interactive: true,
				provider: useResumeTarget
					? (resumeProvider as string)
					: converted.provider,
				model: useResumeTarget ? (resumeModel as string) : converted.model,
				cwd,
				workspaceRoot: cwd,
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				...(converted.prompt ? { prompt: converted.prompt } : {}),
				metadata: baseMetadata,
				startedAt: new Date(startedAtMs).toISOString(),
				status: "completed",
				endedAt: new Date(endedAtMs).toISOString(),
				exitCode: 0,
			});

			await this.sessions.persistSessionMessages(sessionId, messages);

			// Last step on purpose: the importedFrom marker means "this import
			// finished", so a session that fails before this point can never
			// claim the source and block a retry, whatever happens to the row.
			// (updateSession also restores the source tool's title, which
			// creation replaced with a prompt-derived one.)
			const importedFrom: ImportedFromMetadata = {
				tool: converted.tool,
				sourceSessionId: converted.sourceId,
				sourcePath: converted.sourcePath,
				importedAt: new Date().toISOString(),
				sourceProvider: converted.provider,
				sourceModel: converted.model,
			};
			await this.sessions.updateSession({
				sessionId,
				title: converted.title,
				metadata: { ...baseMetadata, importedFrom },
			});
		} catch (error) {
			// Remove the half-written session so history never shows a broken
			// entry (deleteSession tolerates a missing row or missing files);
			// even if this fails, the row carries no importedFrom marker.
			try {
				await this.sessions.deleteSession(sessionId);
			} catch {
				// Best-effort; the original failure is what the caller needs.
			}
			throw error;
		}

		return sessionId;
	}
}
