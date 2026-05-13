import { dirname } from "node:path";
import type * as LlmsProviders from "@cline/llms";
import type { AgentResult, BasicLogger } from "@cline/shared";
import { nanoid } from "nanoid";
import type {
	SubAgentEndContext,
	SubAgentStartContext,
} from "../../extensions/tools/team";
import type { HookEventPayload } from "../../hooks";
import { deleteCheckpointRefs } from "../../hooks/checkpoint-hooks";
import { nowIso, unlinkIfExists } from "../../services/session-artifacts";
import {
	buildManifestFromRow,
	deriveTitleFromPrompt,
	normalizeStoredMessagesForPersistence,
	normalizeTitle,
	resolveMetadataWithTitle,
	sanitizeMetadata,
	withLatestAssistantTurnMetadata,
	withOccRetry,
} from "../../services/session-data";
import type { SessionStatus } from "../../types/common";
import type {
	PersistedSessionUpdateInput,
	SessionMessagesArtifactUploader,
	SessionPersistenceAdapter,
	StoredMessageWithMetadata,
} from "../../types/session";
import type { SessionRow } from "../models/session-row";
import { SessionManifestStore } from "../stores/session-manifest-store";
import { TeamChildSessionManager } from "../team";

export type { PersistedSessionUpdateInput, SessionPersistenceAdapter };

const OCC_MAX_RETRIES = 4;

export class UnifiedSessionPersistenceService {
	private readonly manifestStore: SessionManifestStore;
	private readonly teamChildren: TeamChildSessionManager;
	private static readonly STALE_REASON = "failed_external_process_exit";
	private static readonly STALE_SOURCE = "stale_session_reconciler";
	private static readonly TEAM_HEARTBEAT_LOG_INTERVAL_MS = 30_000;

	constructor(
		private readonly adapter: SessionPersistenceAdapter,
		options: {
			messagesArtifactUploader?: SessionMessagesArtifactUploader;
			logger?: BasicLogger;
		} = {},
	) {
		this.manifestStore = new SessionManifestStore(
			adapter,
			options.messagesArtifactUploader,
			options.logger,
		);
		this.teamChildren = new TeamChildSessionManager(
			adapter,
			this.manifestStore,
			(messages, result, previousMessages) =>
				this.toPersistedMessages(messages, result, previousMessages),
			UnifiedSessionPersistenceService.TEAM_HEARTBEAT_LOG_INTERVAL_MS,
		);
	}

	private toPersistedMessages(
		messages: LlmsProviders.Message[] | undefined,
		result?: AgentResult,
		previousMessages?: LlmsProviders.Message[],
	): StoredMessageWithMetadata[] | undefined {
		if (!messages) return undefined;
		return result
			? withLatestAssistantTurnMetadata(
					result.messages,
					result,
					previousMessages as LlmsProviders.MessageWithMetadata[] | undefined,
				)
			: normalizeStoredMessagesForPersistence(
					messages as LlmsProviders.MessageWithMetadata[],
				);
	}

	ensureSessionsDir(): string {
		return this.manifestStore.ensureSessionsDir();
	}

	writeSessionManifest(
		manifestPath: string,
		manifest: import("../models/session-manifest").SessionManifest,
	): void {
		this.manifestStore.writeSessionManifest(manifestPath, manifest);
	}

	readSessionManifest(
		sessionId: string,
	): import("../models/session-manifest").SessionManifest | undefined {
		return this.manifestStore.readSessionManifest(sessionId);
	}

	async createRootSessionWithArtifacts(
		input: import("../models/session-row").CreateRootSessionWithArtifactsInput,
	): Promise<import("../models/session-row").RootSessionArtifacts> {
		const startedAt = input.startedAt ?? nowIso();
		const providedId = input.sessionId.trim();
		const sessionId =
			providedId.length > 0 ? providedId : `${Date.now()}_${nanoid(5)}`;
		const messagesPath =
			this.manifestStore.artifacts.sessionMessagesPath(sessionId);
		const manifestPath =
			this.manifestStore.artifacts.sessionManifestPath(sessionId);
		const metadata = resolveMetadataWithTitle({
			metadata: input.metadata,
			prompt: input.prompt,
		});
		const manifest = {
			version: 1 as const,
			session_id: sessionId,
			source: input.source,
			pid: input.pid,
			started_at: startedAt,
			status: "running" as const,
			interactive: input.interactive,
			provider: input.provider,
			model: input.model,
			cwd: input.cwd,
			workspace_root: input.workspaceRoot,
			team_name: input.teamName,
			enable_tools: input.enableTools,
			enable_spawn: input.enableSpawn,
			enable_teams: input.enableTeams,
			prompt: input.prompt?.trim() || undefined,
			metadata,
			messages_path: messagesPath,
		};

		await this.adapter.upsertSession({
			sessionId,
			source: input.source,
			pid: input.pid,
			startedAt,
			endedAt: null,
			exitCode: null,
			status: "running",
			statusLock: 0,
			interactive: input.interactive,
			provider: input.provider,
			model: input.model,
			cwd: input.cwd,
			workspaceRoot: input.workspaceRoot,
			teamName: input.teamName ?? null,
			enableTools: input.enableTools,
			enableSpawn: input.enableSpawn,
			enableTeams: input.enableTeams,
			parentSessionId: null,
			parentAgentId: null,
			agentId: null,
			conversationId: null,
			isSubagent: false,
			prompt: manifest.prompt ?? null,
			metadata: sanitizeMetadata(manifest.metadata),
			hookPath: "",
			messagesPath,
			updatedAt: nowIso(),
		});

		this.manifestStore.initializeMessagesFile(
			sessionId,
			messagesPath,
			startedAt,
		);
		this.manifestStore.writeSessionManifest(manifestPath, manifest);
		return { manifestPath, messagesPath, manifest };
	}

	async updateSessionStatus(
		sessionId: string,
		status: SessionStatus,
		exitCode?: number | null,
	): Promise<{ updated: boolean; endedAt?: string }> {
		let endedAt: string | undefined;
		const result = await withOccRetry(
			() => this.adapter.getSession(sessionId),
			async (row) => {
				endedAt = status === "running" ? undefined : nowIso();
				return this.adapter.updateSession({
					sessionId,
					status,
					endedAt: endedAt ?? null,
					exitCode:
						status === "running"
							? null
							: typeof exitCode === "number"
								? exitCode
								: null,
					expectedStatusLock: row.statusLock,
				});
			},
			OCC_MAX_RETRIES,
		);
		if (result.updated) {
			if (status === "cancelled") {
				await this.teamChildren.applyStatusToRunningChildSessions(
					sessionId,
					"cancelled",
				);
			}
			return { updated: true, endedAt };
		}
		return { updated: false };
	}

	async updateSession(input: {
		sessionId: string;
		prompt?: string | null;
		metadata?: Record<string, unknown> | null;
		title?: string | null;
	}): Promise<{ updated: boolean }> {
		for (let attempt = 0; attempt < OCC_MAX_RETRIES; attempt++) {
			const row = await this.adapter.getSession(input.sessionId);
			if (!row) return { updated: false };

			const existingMeta = row.metadata ?? undefined;
			const baseMeta =
				input.metadata !== undefined
					? (sanitizeMetadata(input.metadata) ?? {})
					: (sanitizeMetadata(existingMeta) ?? {});

			const existingTitle = normalizeTitle(
				typeof existingMeta?.title === "string"
					? (existingMeta.title as string)
					: undefined,
			);
			const nextTitle =
				input.title !== undefined
					? normalizeTitle(input.title)
					: (existingTitle ?? deriveTitleFromPrompt(input.prompt));

			if (nextTitle) {
				baseMeta.title = nextTitle;
			} else {
				delete baseMeta.title;
			}

			const hasMetadataChange =
				input.metadata !== undefined ||
				input.prompt !== undefined ||
				input.title !== undefined;

			const changed = await this.adapter.updateSession({
				sessionId: input.sessionId,
				prompt: input.prompt,
				metadata: hasMetadataChange
					? Object.keys(baseMeta).length > 0
						? baseMeta
						: null
					: undefined,
				title: nextTitle,
				expectedStatusLock: row.statusLock,
			});
			if (!changed.updated) continue;

			const { path: manifestPath, manifest } =
				this.manifestStore.readManifestFile(input.sessionId);
			if (manifest) {
				if (input.prompt !== undefined) {
					manifest.prompt = input.prompt ?? undefined;
				}
				const manifestMeta =
					input.metadata !== undefined
						? (sanitizeMetadata(input.metadata) ?? {})
						: (sanitizeMetadata(manifest.metadata) ?? {});
				if (nextTitle) manifestMeta.title = nextTitle;
				manifest.metadata =
					Object.keys(manifestMeta).length > 0 ? manifestMeta : undefined;
				this.manifestStore.writeSessionManifest(manifestPath, manifest);
			}
			return { updated: true };
		}
		return { updated: false };
	}

	queueSpawnRequest(event: HookEventPayload): Promise<void> {
		return this.teamChildren.queueSpawnRequest(event);
	}

	upsertSubagentSession(
		input: import("../models/session-row").UpsertSubagentInput,
	): Promise<string | undefined> {
		return this.teamChildren.upsertSubagentSession(input);
	}

	upsertSubagentSessionFromHook(
		event: HookEventPayload,
	): Promise<string | undefined> {
		return this.teamChildren.upsertSubagentSessionFromHook(event);
	}

	appendSubagentHookAudit(
		_subSessionId: string,
		event: HookEventPayload,
	): Promise<void> {
		this.teamChildren.appendSubagentHookAudit(event);
		return Promise.resolve();
	}

	persistSessionMessages(
		sessionId: string,
		messages: LlmsProviders.Message[],
		systemPrompt?: string,
	): Promise<void> {
		const normalizedMessages = normalizeStoredMessagesForPersistence(
			messages as LlmsProviders.MessageWithMetadata[],
		);
		return this.manifestStore.persistSessionMessages(
			sessionId,
			normalizedMessages,
			systemPrompt,
		);
	}

	applySubagentStatus(
		subSessionId: string,
		event: HookEventPayload,
	): Promise<void> {
		return this.teamChildren.applySubagentStatus(subSessionId, event);
	}

	applySubagentStatusBySessionId(
		subSessionId: string,
		status: SessionStatus,
	): Promise<void> {
		return this.teamChildren.applySubagentStatusBySessionId(
			subSessionId,
			status,
		);
	}

	applyStatusToRunningChildSessions(
		parentSessionId: string,
		status: Exclude<SessionStatus, "running">,
	): Promise<void> {
		return this.teamChildren.applyStatusToRunningChildSessions(
			parentSessionId,
			status,
		);
	}

	onTeamTaskStart(
		rootSessionId: string,
		agentId: string,
		message: string,
	): Promise<void> {
		return this.teamChildren.onTeamTaskStart(rootSessionId, agentId, message);
	}

	onTeamTaskEnd(
		rootSessionId: string,
		agentId: string,
		status: SessionStatus,
		summary?: string,
		result?: AgentResult,
		messages?: LlmsProviders.Message[],
	): Promise<void> {
		return this.teamChildren.onTeamTaskEnd(
			rootSessionId,
			agentId,
			status,
			summary,
			result,
			messages,
		);
	}

	onTeamTaskProgress(
		rootSessionId: string,
		agentId: string,
		progress: string,
		options?: { kind?: "heartbeat" | "progress" | "text" },
	): Promise<void> {
		return this.teamChildren.onTeamTaskProgress(
			rootSessionId,
			agentId,
			progress,
			options,
		);
	}

	handleSubAgentStart(
		rootSessionId: string,
		context: SubAgentStartContext,
	): Promise<void> {
		return this.teamChildren.handleSubAgentStart(rootSessionId, context);
	}

	handleSubAgentEnd(
		rootSessionId: string,
		context: SubAgentEndContext,
	): Promise<void> {
		return this.teamChildren.handleSubAgentEnd(rootSessionId, context);
	}

	private isPidAlive(pid: number): boolean {
		if (!Number.isFinite(pid) || pid <= 0) return false;
		try {
			process.kill(Math.floor(pid), 0);
			return true;
		} catch (error) {
			return (
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				(error as { code?: string }).code === "EPERM"
			);
		}
	}

	private async reconcileDeadRunningSession(
		row: SessionRow,
	): Promise<SessionRow | undefined> {
		if (row.status !== "running" || this.isPidAlive(row.pid)) return row;

		const detectedAt = nowIso();
		const reason = UnifiedSessionPersistenceService.STALE_REASON;

		for (let attempt = 0; attempt < OCC_MAX_RETRIES; attempt++) {
			const latest = await this.adapter.getSession(row.sessionId);
			if (!latest) return undefined;
			if (latest.status !== "running") return latest;

			const nextMetadata = {
				...(latest.metadata ?? {}),
				terminal_marker: reason,
				terminal_marker_at: detectedAt,
				terminal_marker_pid: latest.pid,
				terminal_marker_source: UnifiedSessionPersistenceService.STALE_SOURCE,
			};

			const changed = await this.adapter.updateSession({
				sessionId: latest.sessionId,
				status: "failed",
				endedAt: detectedAt,
				exitCode: 1,
				metadata: nextMetadata,
				expectedStatusLock: latest.statusLock,
			});
			if (!changed.updated) continue;

			await this.teamChildren.applyStatusToRunningChildSessions(
				latest.sessionId,
				"failed",
			);

			const manifest = buildManifestFromRow(latest, {
				status: "failed",
				endedAt: detectedAt,
				exitCode: 1,
				metadata: nextMetadata,
			});
			const { path: manifestPath } = this.manifestStore.readManifestFile(
				latest.sessionId,
			);
			this.manifestStore.writeSessionManifest(manifestPath, manifest);
			this.manifestStore.appendStaleSessionHookLog(
				detectedAt,
				latest.sessionId,
				latest.pid,
				reason,
				UnifiedSessionPersistenceService.STALE_SOURCE,
			);
			return {
				...latest,
				status: "failed",
				endedAt: detectedAt,
				exitCode: 1,
				metadata: nextMetadata,
				statusLock: changed.statusLock,
				updatedAt: detectedAt,
			};
		}
		return await this.adapter.getSession(row.sessionId);
	}

	async listSessions(limit = 200): Promise<SessionRow[]> {
		const requestedLimit = Math.max(1, Math.floor(limit));
		const scanLimit = Math.min(requestedLimit * 5, 2000);
		await this.reconcileDeadSessions(scanLimit);

		const rows = await this.adapter.listSessions({ limit: scanLimit });
		return rows.slice(0, requestedLimit).map((row) => {
			const meta = sanitizeMetadata(row.metadata ?? undefined);
			const manifest = this.manifestStore.readSessionManifest(row.sessionId);
			const manifestTitle = normalizeTitle(
				typeof manifest?.metadata?.title === "string"
					? (manifest.metadata.title as string)
					: undefined,
			);
			const resolved = manifestTitle
				? { ...(meta ?? {}), title: manifestTitle }
				: meta;
			return { ...row, metadata: resolved };
		});
	}

	async reconcileDeadSessions(limit = 2000): Promise<number> {
		const rows = await this.adapter.listSessions({
			limit: Math.max(1, Math.floor(limit)),
			status: "running",
		});
		let reconciled = 0;
		for (const row of rows) {
			const updated = await this.reconcileDeadRunningSession(row);
			if (updated && updated.status !== row.status) reconciled++;
		}
		return reconciled;
	}

	async deleteSession(sessionId: string): Promise<{ deleted: boolean }> {
		const id = sessionId.trim();
		if (!id) throw new Error("session id is required");

		const row = await this.adapter.getSession(id);
		if (!row) return { deleted: false };

		await this.adapter.deleteSession(id, false);

		if (!row.isSubagent) {
			const children = await this.adapter.listSessions({
				limit: 2000,
				parentSessionId: id,
			});
			await this.adapter.deleteSession(id, true);
			await Promise.allSettled(
				children.map(async (child) => {
					await deleteCheckpointRefs(child.cwd, child.sessionId);
					unlinkIfExists(child.messagesPath);
					unlinkIfExists(
						this.manifestStore.artifacts.sessionManifestPath(
							child.sessionId,
							false,
						),
					);
					this.manifestStore.artifacts.removeSessionDirIfEmpty(child.sessionId);
				}),
			);
		}

		await deleteCheckpointRefs(row.cwd, id);

		unlinkIfExists(row.messagesPath);
		unlinkIfExists(this.manifestStore.artifacts.sessionManifestPath(id, false));
		if (row.isSubagent) {
			this.manifestStore.artifacts.removeSessionDirIfEmpty(id);
		} else {
			const candidateDirs = new Set<string>([
				this.manifestStore.artifacts.sessionArtifactsDir(id),
			]);
			for (const path of [row.messagesPath]) {
				if (typeof path === "string" && path.trim().length > 0) {
					candidateDirs.add(dirname(path));
				}
			}
			for (const dir of candidateDirs) {
				this.manifestStore.artifacts.removeDir(dir);
			}
		}
		return { deleted: true };
	}
}
