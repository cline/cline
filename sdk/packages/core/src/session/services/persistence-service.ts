import { existsSync } from "node:fs";
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
import {
	isNonTerminalSessionStatus,
	type SessionStatus,
	type TerminalSessionStatus,
} from "../../types/common";
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
const DEFAULT_SESSION_CLEANUP_INTERVAL_MS = 60_000;
const DEFAULT_SESSION_CLEANUP_LIMIT = 2000;
const SESSION_LIST_PAGE_SIZE = 500;
const MAX_SESSION_LIST_SCAN_ROWS = 10_000;

export interface BackgroundSessionCleanupOptions {
	intervalMs?: number;
	limit?: number;
}

export class UnifiedSessionPersistenceService {
	private readonly manifestStore: SessionManifestStore;
	private readonly teamChildren: TeamChildSessionManager;
	private readonly logger: BasicLogger | undefined;
	private missingArtifactCleanupPromise: Promise<number> | undefined;
	private missingArtifactCleanupLimit = 0;
	private pendingMissingArtifactCleanupLimit = 0;
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
		this.logger = options.logger;
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
				endedAt = isNonTerminalSessionStatus(status) ? undefined : nowIso();
				return this.adapter.updateSession({
					sessionId,
					status,
					endedAt: endedAt ?? null,
					exitCode: isNonTerminalSessionStatus(status)
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
		status: TerminalSessionStatus,
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
		if (
			isNonTerminalSessionStatus(row.status) === false ||
			!this.hasPersistedArtifacts(row) ||
			this.isPidAlive(row.pid)
		) {
			return row;
		}

		const detectedAt = nowIso();
		const reason = UnifiedSessionPersistenceService.STALE_REASON;

		for (let attempt = 0; attempt < OCC_MAX_RETRIES; attempt++) {
			const latest = await this.adapter.getSession(row.sessionId);
			if (!latest) return undefined;
			if (isNonTerminalSessionStatus(latest.status) === false) return latest;

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

	private normalizeArtifactPath(
		path: string | null | undefined,
	): string | undefined {
		return typeof path === "string" && path.trim().length > 0
			? path
			: undefined;
	}

	private hasRootArtifacts(sessionId: string, messagesPath?: string): boolean {
		const sessionDir =
			this.manifestStore.artifacts.sessionArtifactsDir(sessionId);
		if (!existsSync(sessionDir)) {
			return false;
		}

		const manifestPath = this.manifestStore.artifacts.sessionManifestPath(
			sessionId,
			false,
		);
		return (
			existsSync(manifestPath) || !!(messagesPath && existsSync(messagesPath))
		);
	}

	private hasPersistedArtifacts(row: SessionRow): boolean {
		const messagesPath = this.normalizeArtifactPath(row.messagesPath);

		if (row.isSubagent) {
			if (messagesPath) {
				return existsSync(messagesPath);
			}
			const parentSessionId = this.normalizeArtifactPath(row.parentSessionId);
			return parentSessionId ? this.hasRootArtifacts(parentSessionId) : false;
		}

		return this.hasRootArtifacts(row.sessionId, messagesPath);
	}

	private isLiveNonTerminalSession(row: SessionRow): boolean {
		return isNonTerminalSessionStatus(row.status) && this.isPidAlive(row.pid);
	}

	private async pruneMissingArtifactSessions(limit = 2000): Promise<number> {
		const requestedLimit = Math.max(1, Math.floor(limit));
		const rows = await this.adapter.listSessions({ limit: requestedLimit });
		let pruned = 0;
		const prunedRootSessionIds = new Set<string>();
		for (const row of rows) {
			if (
				row.isSubagent &&
				row.parentSessionId &&
				prunedRootSessionIds.has(row.parentSessionId)
			) {
				continue;
			}
			if (this.isLiveNonTerminalSession(row)) {
				continue;
			}
			if (
				row.isSubagent &&
				!this.normalizeArtifactPath(row.messagesPath) &&
				row.parentSessionId
			) {
				const parent = await this.adapter.getSession(row.parentSessionId);
				if (parent && this.isLiveNonTerminalSession(parent)) {
					continue;
				}
			}
			if (this.hasPersistedArtifacts(row)) {
				continue;
			}
			const result = await this.deleteSession(row.sessionId);
			if (result.deleted) {
				pruned++;
				if (!row.isSubagent) {
					prunedRootSessionIds.add(row.sessionId);
				}
			}
		}
		return pruned;
	}

	async reconcileMissingArtifactSessions(limit = 2000): Promise<number> {
		const requestedLimit = Math.max(1, Math.floor(limit));
		if (this.missingArtifactCleanupPromise) {
			if (requestedLimit <= this.missingArtifactCleanupLimit) {
				return await this.missingArtifactCleanupPromise;
			}
			this.pendingMissingArtifactCleanupLimit = Math.max(
				this.pendingMissingArtifactCleanupLimit,
				requestedLimit,
			);
			await this.missingArtifactCleanupPromise;
			return await this.reconcileMissingArtifactSessions(requestedLimit);
		}
		this.pendingMissingArtifactCleanupLimit = 0;
		const cleanup = this.pruneMissingArtifactSessions(requestedLimit);
		this.missingArtifactCleanupPromise = cleanup;
		this.missingArtifactCleanupLimit = requestedLimit;
		try {
			return await this.missingArtifactCleanupPromise;
		} finally {
			if (this.missingArtifactCleanupPromise === cleanup) {
				this.missingArtifactCleanupPromise = undefined;
				this.missingArtifactCleanupLimit = 0;
				const pendingLimit = this.pendingMissingArtifactCleanupLimit;
				this.pendingMissingArtifactCleanupLimit = 0;
				if (pendingLimit > requestedLimit) {
					this.scheduleMissingArtifactCleanup(pendingLimit);
				}
			}
		}
	}

	private scheduleMissingArtifactCleanup(limit = 2000): void {
		const timer = setTimeout(() => {
			void this.reconcileMissingArtifactSessions(limit).catch((error) => {
				this.logger?.log("Session artifact cleanup failed", {
					severity: "warn",
					error,
				});
			});
		}, 0);
		timer.unref?.();
	}

	private runScheduledMissingArtifactCleanup(limit = 2000): void {
		void this.reconcileMissingArtifactSessions(limit).catch((error) => {
			this.logger?.log("Session artifact cleanup failed", {
				severity: "warn",
				error,
			});
		});
	}

	startBackgroundSessionCleanup(
		options: BackgroundSessionCleanupOptions = {},
	): () => void {
		const limit = Math.max(
			1,
			Math.floor(options.limit ?? DEFAULT_SESSION_CLEANUP_LIMIT),
		);
		const intervalMs = Math.max(
			1_000,
			Math.floor(options.intervalMs ?? DEFAULT_SESSION_CLEANUP_INTERVAL_MS),
		);
		this.scheduleMissingArtifactCleanup(limit);
		const interval = setInterval(() => {
			this.runScheduledMissingArtifactCleanup(limit);
		}, intervalMs);
		interval.unref?.();
		return () => clearInterval(interval);
	}

	private withResolvedHistoryMetadata(row: SessionRow): SessionRow {
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
	}

	private async listRowsWithPersistedArtifacts(
		requestedLimit: number,
	): Promise<SessionRow[]> {
		const rows: SessionRow[] = [];
		const pageSize = Math.max(
			requestedLimit,
			Math.min(SESSION_LIST_PAGE_SIZE, MAX_SESSION_LIST_SCAN_ROWS),
		);
		const maxScanRows = Math.max(
			DEFAULT_SESSION_CLEANUP_LIMIT,
			Math.min(MAX_SESSION_LIST_SCAN_ROWS, requestedLimit * 10),
		);
		let offset = 0;
		while (rows.length < requestedLimit && offset < maxScanRows) {
			const batchLimit = Math.min(pageSize, maxScanRows - offset);
			const batch = await this.adapter.listSessions({
				limit: batchLimit,
				offset,
			});
			if (batch.length === 0) {
				break;
			}
			for (const row of batch) {
				if (this.hasPersistedArtifacts(row)) {
					rows.push(row);
					if (rows.length >= requestedLimit) {
						break;
					}
				}
			}
			if (batch.length < batchLimit) {
				break;
			}
			offset += batch.length;
		}
		return rows;
	}

	async listSessions(limit = 200): Promise<SessionRow[]> {
		const requestedLimit = Math.max(1, Math.floor(limit));
		const cleanupLimit = Math.max(
			DEFAULT_SESSION_CLEANUP_LIMIT,
			Math.min(MAX_SESSION_LIST_SCAN_ROWS, requestedLimit * 10),
		);
		const deadSessionScanLimit = Math.min(requestedLimit * 5, 2000);
		this.scheduleMissingArtifactCleanup(cleanupLimit);
		await this.reconcileDeadSessions(deadSessionScanLimit);

		const rows = await this.listRowsWithPersistedArtifacts(requestedLimit);
		return rows.map((row) => this.withResolvedHistoryMetadata(row));
	}

	async reconcileDeadSessions(limit = 2000): Promise<number> {
		const requestedLimit = Math.max(1, Math.floor(limit));
		const rows = (
			await Promise.all(
				(["idle", "running", "pending"] as const).map((status) =>
					this.adapter.listSessions({
						limit: requestedLimit,
						status,
					}),
				),
			)
		).flat();
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
