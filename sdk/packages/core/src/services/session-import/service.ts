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

	/** `tool:sourceId` → existing Cline session id, from prior imports. */
	private async existingImports(): Promise<Map<string, string>> {
		const existing = new Map<string, string>();
		try {
			for (const row of await this.sessions.listSessions(2000)) {
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
		try {
			return await this.importOneUnmanaged(request, options);
		} finally {
			this.disposeAdapters();
		}
	}

	private async importOneUnmanaged(
		request: SessionImportRequest,
		options: SessionImportOptions,
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
		try {
			for (const [index, request] of requests.entries()) {
				// Per-session transactional: one bad source session fails one
				// item. Adapter caches (file indexes, db snapshots) live for the
				// whole batch and are released once at the end.
				const result = await this.importOneUnmanaged(request, options);
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

		const artifacts = await this.sessions.createRootSessionWithArtifacts({
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
			metadata: {
				title: converted.title,
				importedFrom: {
					tool: converted.tool,
					sourceSessionId: converted.sourceId,
					sourcePath: converted.sourcePath,
					importedAt: new Date().toISOString(),
					sourceProvider: converted.provider,
					sourceModel: converted.model,
				} satisfies ImportedFromMetadata,
				...(converted.gitBranch
					? { git: { branch: converted.gitBranch } }
					: {}),
			},
			startedAt: new Date(startedAtMs).toISOString(),
		});

		await this.sessions.persistSessionMessages(sessionId, messages);

		// Imported sessions are history from the moment they land: terminal
		// status, or the stale-session reconciler flips pid-0 rows to failed.
		await this.sessions.updateSessionStatus(sessionId, "completed", 0);
		const endedAtMs = Number.isFinite(converted.endedAtMs)
			? converted.endedAtMs
			: startedAtMs;
		const manifest = artifacts.manifest;
		manifest.status = "completed";
		manifest.ended_at = new Date(endedAtMs).toISOString();
		manifest.exit_code = 0;
		this.sessions.writeSessionManifest(artifacts.manifestPath, manifest);

		// Session creation derives metadata.title from the prompt; restore the
		// source tool's own title on both the row and the manifest.
		await this.sessions.updateSession({ sessionId, title: converted.title });

		return sessionId;
	}
}
