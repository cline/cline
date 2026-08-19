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
	SessionDeleteGuard,
	SessionListCursor,
	SessionMessagesArtifactUploader,
	SessionPersistenceAdapter,
	StoredMessageWithMetadata,
} from "../../types/session";
import { withSessionHistoryOriginMetadata } from "../history-origin";
import type { SessionCompactionState } from "../models/session-compaction";
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
		messages: LlmsProviders.MessageWithMetadata[] | undefined,
		result?: AgentResult,
		previousMessages?: LlmsProviders.MessageWithMetadata[],
	): StoredMessageWithMetadata[] | undefined {
		if (!messages) return undefined;
		return result
			? withLatestAssistantTurnMetadata(
					result.messages,
					result,
					previousMessages,
				)
			: normalizeStoredMessagesForPersistence(messages);
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
		const compactionPath =
			this.manifestStore.artifacts.sessionCompactionPath(sessionId);
		const manifestPath =
			this.manifestStore.artifacts.sessionManifestPath(sessionId);
		const metadata = resolveMetadataWithTitle({
			metadata: withSessionHistoryOriginMetadata(input.metadata, {
				mode: input.mode,
				version: input.version,
			}),
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

		const row: SessionRow = {
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
		};
		await this.adapter.upsertSession(row);

		this.manifestStore.initializeMessagesFile(row, messagesPath, startedAt);
		this.manifestStore.writeSessionManifest(manifestPath, manifest);
		return { manifestPath, messagesPath, compactionPath, manifest };
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
		messages: LlmsProviders.MessageWithMetadata[],
		systemPrompt?: string,
	): Promise<void> {
		const normalizedMessages = normalizeStoredMessagesForPersistence(messages);
		return this.manifestStore.persistSessionMessages(
			sessionId,
			normalizedMessages,
			systemPrompt,
		);
	}

	async readSessionCompactionState(
		sessionId: string,
	): Promise<SessionCompactionState | undefined> {
		return await this.manifestStore.readSessionCompactionState(sessionId);
	}

	async persistSessionCompactionState(
		sessionId: string,
		state: SessionCompactionState,
	): Promise<void> {
		await this.manifestStore.persistSessionCompactionState(sessionId, state);
	}

	async deleteSessionCompactionState(sessionId: string): Promise<void> {
		await this.manifestStore.deleteSessionCompactionState(sessionId);
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
		messages?: LlmsProviders.MessageWithMetadata[],
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
			!(await this.hasPersistedArtifacts(row)) ||
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

	/**
	 * Walks `parentSessionId` links up to the root (non-subagent) session row.
	 * Subagent rows normally point straight at the root session, but nested
	 * subagents may be chained through intermediate subagent rows; artifact
	 * and liveness decisions must anchor at the root either way. Returns
	 * `undefined` when the chain is broken (a parent row is missing) or
	 * cyclic.
	 */
	private async resolveRootAncestorSession(
		row: SessionRow,
	): Promise<SessionRow | undefined> {
		const seen = new Set<string>([row.sessionId]);
		let current: SessionRow | undefined = row;
		while (current?.isSubagent) {
			const parentSessionId = this.normalizeArtifactPath(
				current.parentSessionId,
			);
			if (!parentSessionId || seen.has(parentSessionId)) {
				return undefined;
			}
			seen.add(parentSessionId);
			current = await this.adapter.getSession(parentSessionId);
		}
		return current;
	}

	private async hasPersistedArtifacts(row: SessionRow): Promise<boolean> {
		const messagesPath = this.normalizeArtifactPath(row.messagesPath);

		if (row.isSubagent) {
			if (messagesPath) {
				return existsSync(messagesPath);
			}
			const root = await this.resolveRootAncestorSession(row);
			if (root) {
				return this.hasRootArtifacts(
					root.sessionId,
					this.normalizeArtifactPath(root.messagesPath),
				);
			}
			// Parent chain broken: fall back to treating the direct parent id
			// as the artifact anchor (flat parent-link topology).
			const parentSessionId = this.normalizeArtifactPath(row.parentSessionId);
			return parentSessionId ? this.hasRootArtifacts(parentSessionId) : false;
		}

		return this.hasRootArtifacts(row.sessionId, messagesPath);
	}

	private isLiveNonTerminalSession(row: SessionRow): boolean {
		return isNonTerminalSessionStatus(row.status) && this.isPidAlive(row.pid);
	}

	/**
	 * True when any ancestor session along the `parentSessionId` chain is
	 * still a live non-terminal session. Covers both flat (subagent -> root)
	 * and nested (subagent -> subagent -> root) topologies.
	 */
	private async hasLiveAncestorSession(row: SessionRow): Promise<boolean> {
		const seen = new Set<string>([row.sessionId]);
		let current: SessionRow | undefined = row;
		while (current?.isSubagent) {
			const parentSessionId = this.normalizeArtifactPath(
				current.parentSessionId,
			);
			if (!parentSessionId || seen.has(parentSessionId)) {
				return false;
			}
			seen.add(parentSessionId);
			current = await this.adapter.getSession(parentSessionId);
			if (current && this.isLiveNonTerminalSession(current)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Returns whether the stale-row preconditions hold for `row`: it is not a
	 * live non-terminal session, it is not a subagent row covered by a live
	 * ancestor, and its artifacts are missing from disk.
	 */
	private async isPrunableStaleRow(row: SessionRow): Promise<boolean> {
		if (this.isLiveNonTerminalSession(row)) {
			return false;
		}
		if (
			row.isSubagent &&
			!this.normalizeArtifactPath(row.messagesPath) &&
			(await this.hasLiveAncestorSession(row))
		) {
			return false;
		}
		return !(await this.hasPersistedArtifacts(row));
	}

	/**
	 * Deletes a session row that was checked to be stale, guarding against
	 * the row changing between the check and the delete (e.g. the session
	 * resuming or its artifacts being recreated). The preconditions are
	 * re-verified against a fresh read at the delete boundary, and the row
	 * delete itself is conditional on the re-read `statusLock`/`updatedAt`
	 * version, so a concurrent update always wins over the cleanup.
	 */
	private async deleteStaleSessionRow(
		checked: SessionRow,
	): Promise<{ deleted: boolean }> {
		const latest = await this.adapter.getSession(checked.sessionId);
		if (!latest) {
			return { deleted: false };
		}
		if (
			latest.statusLock !== checked.statusLock ||
			latest.updatedAt !== checked.updatedAt ||
			latest.startedAt !== checked.startedAt
		) {
			// Not the row we checked anymore; leave it alone.
			return { deleted: false };
		}
		if (!(await this.isPrunableStaleRow(latest))) {
			return { deleted: false };
		}
		return await this.deleteSessionRow(latest, {
			expectedStatusLock: latest.statusLock,
			expectedUpdatedAt: latest.updatedAt,
		});
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
			if (!(await this.isPrunableStaleRow(row))) {
				continue;
			}
			const result = await this.deleteStaleSessionRow(row);
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

	/**
	 * Collects the most recent rows whose artifacts still exist on disk.
	 *
	 * Pagination uses a keyset cursor (the last row of the previous page)
	 * instead of a positional OFFSET: the concurrent missing-artifact cleanup
	 * deletes rows from this same ordered set, and with OFFSET a deletion in
	 * an earlier page would shift surviving rows backwards across the offset
	 * boundary and silently skip them. The cursor is a row value, so deletions
	 * before it cannot move rows across the page boundary.
	 *
	 * The scan is not capped: an arbitrarily large prefix of stale rows must
	 * not hide older valid sessions, so we keep paging until enough surviving
	 * rows are found or the ordered set is exhausted.
	 */
	private async listRowsWithPersistedArtifacts(
		requestedLimit: number,
	): Promise<SessionRow[]> {
		const rows: SessionRow[] = [];
		const pageSize = Math.max(requestedLimit, SESSION_LIST_PAGE_SIZE);
		let cursor: SessionListCursor | undefined;
		while (rows.length < requestedLimit) {
			const batch = await this.adapter.listSessions({
				limit: pageSize,
				startedBefore: cursor,
			});
			if (batch.length === 0) {
				break;
			}
			for (const row of batch) {
				if (rows.length >= requestedLimit) {
					break;
				}
				if (await this.hasPersistedArtifacts(row)) {
					rows.push(row);
				}
			}
			if (batch.length < pageSize) {
				break;
			}
			const last = batch[batch.length - 1];
			cursor = { startedAt: last.startedAt, sessionId: last.sessionId };
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
		// Resolve manifest titles concurrently and off-thread. Each row only needs
		// the manifest's `metadata.title`, so read just that asynchronously instead
		// of synchronously reading + Zod-parsing the entire manifest per row.
		const manifestTitles = await Promise.all(
			rows.map((row) =>
				this.manifestStore.readSessionManifestTitle(row.sessionId),
			),
		);
		return rows.map((row, index) => {
			const meta = sanitizeMetadata(row.metadata ?? undefined);
			const manifestTitle = normalizeTitle(manifestTitles[index]);
			const resolved = manifestTitle
				? { ...(meta ?? {}), title: manifestTitle }
				: meta;
			return { ...row, metadata: resolved };
		});
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

		return await this.deleteSessionRow(row);
	}

	/**
	 * Deletes `row` plus its children and on-disk artifacts. When `guard` is
	 * provided, the row delete is conditional on the row still matching the
	 * observed `statusLock`/`updatedAt`; if the row changed concurrently the
	 * delete is a no-op and neither children nor artifacts are touched.
	 */
	private async deleteSessionRow(
		row: SessionRow,
		guard?: SessionDeleteGuard,
	): Promise<{ deleted: boolean }> {
		const id = row.sessionId;
		const rowDeleted = await this.adapter.deleteSession(id, false, guard);
		if (guard && !rowDeleted) {
			// Lost the race against a concurrent update; keep row + artifacts.
			return { deleted: false };
		}

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
					await this.deleteSessionCompactionStateIfExists(child.sessionId);
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
		await this.deleteSessionCompactionStateIfExists(id);
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

	private async deleteSessionCompactionStateIfExists(
		sessionId: string,
	): Promise<void> {
		try {
			await this.manifestStore.deleteSessionCompactionState(sessionId);
		} catch {}
	}
}
