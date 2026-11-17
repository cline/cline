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
import { withSessionHistoryOriginMetadata } from "../history-origin";
import type { SessionCompactionState } from "../models/session-compaction";
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
	/**
	 * Rows whose owning pid has been seen dead for less than this long are
	 * left alone by the reconciler: a window reload or extension-host restart
	 * replaces the pid within seconds of startup, no matter how long the
	 * session sat idle before dying, and marking the row failed in between
	 * makes the resumed session flicker through a terminal state (and fire
	 * the shutdown hook) before adoption can rebind it. The first-sight time
	 * is persisted in the row metadata so fast restarts keep the same clock;
	 * a one-shot delayed re-check marks genuinely dead rows once the grace
	 * has elapsed. Pass `staleMarkGraceMs: 0` in the constructor options to
	 * disable (tests).
	 */
	private static readonly STALE_MARK_GRACE_MS = 90_000;
	/**
	 * Metadata key holding the epoch ms when the reconciler first observed
	 * the row's owning pid dead. Deliberately ignores updatedAt/startedAt —
	 * an idle session's last write can be arbitrarily old even though its
	 * owner just died. Persisted (not in-memory) so a host restart does not
	 * reset the window and repeatedly fast-restarting hosts still converge.
	 */
	private static readonly STALE_FIRST_SEEN_KEY = "stale_first_seen_at";
	private readonly staleMarkGraceMs: number;
	private staleRecheckTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly adapter: SessionPersistenceAdapter,
		options: {
			messagesArtifactUploader?: SessionMessagesArtifactUploader;
			logger?: BasicLogger;
			staleMarkGraceMs?: number;
		} = {},
	) {
		this.staleMarkGraceMs = Math.max(
			0,
			options.staleMarkGraceMs ??
				UnifiedSessionPersistenceService.STALE_MARK_GRACE_MS,
		);
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
		const status: SessionStatus = input.status ?? "running";
		const terminal = !isNonTerminalSessionStatus(status);
		const endedAt = terminal ? (input.endedAt ?? nowIso()) : undefined;
		const exitCode = terminal ? (input.exitCode ?? 0) : undefined;
		const manifest = {
			version: 1 as const,
			session_id: sessionId,
			source: input.source,
			pid: input.pid,
			started_at: startedAt,
			...(endedAt ? { ended_at: endedAt } : {}),
			...(exitCode !== undefined ? { exit_code: exitCode } : {}),
			status,
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
			endedAt: endedAt ?? null,
			exitCode: exitCode ?? null,
			status,
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
		pid?: number,
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
					pid: isNonTerminalSessionStatus(status) ? pid : undefined,
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

	async adoptOrphanedSession(
		sessionId: string,
		pid: number,
	): Promise<{ updated: boolean }> {
		for (let attempt = 0; attempt < OCC_MAX_RETRIES; attempt++) {
			const row = await this.adapter.getSession(sessionId);
			if (!row || !this.isOrphaned(row)) return { updated: false };
			const changed = await this.adapter.updateSession({
				sessionId,
				status: "idle",
				endedAt: null,
				exitCode: null,
				pid,
				metadata: this.withoutStaleTerminalMarkers(row.metadata),
				expectedStatusLock: row.statusLock,
			});
			if (!changed.updated) continue;
			await this.clearStaleTerminalMarkerManifest(sessionId);
			return { updated: true };
		}
		return { updated: false };
	}

	/**
	 * Strips the reconciler's failure markers from a metadata object. Once a
	 * session is adopted under a live pid the `terminal_marker_*` keys are
	 * stale: they would linger in history views and leak into future resume
	 * manifests. Returns the input unchanged when nothing was removed.
	 */
	private withoutStaleTerminalMarkers(
		metadata: Record<string, unknown> | null | undefined,
	): Record<string, unknown> | null | undefined {
		if (!metadata) return metadata;
		const cleaned: Record<string, unknown> = {};
		let removed = false;
		for (const [key, value] of Object.entries(metadata)) {
			if (key.startsWith("terminal_marker")) {
				removed = true;
				continue;
			}
			cleaned[key] = value;
		}
		return removed ? cleaned : metadata;
	}

	/**
	 * The reconciler writes its failure markers into the manifest file as
	 * well as the DB row; adoption must clear both or the stale failure
	 * survives the next resume through the manifest metadata. Best effort —
	 * the DB row is already clean by the time this runs.
	 */
	private async clearStaleTerminalMarkerManifest(
		sessionId: string,
	): Promise<void> {
		try {
			const { path: manifestPath, manifest } =
				this.manifestStore.readManifestFile(sessionId);
			if (!manifest?.metadata) return;
			const cleaned = this.withoutStaleTerminalMarkers(manifest.metadata);
			if (cleaned === manifest.metadata) return;
			this.manifestStore.writeSessionManifest(manifestPath, {
				...manifest,
				metadata: cleaned ?? undefined,
			});
		} catch {
			// Manifest cleanup is best effort; the DB row already has no markers.
		}
	}

	async updateSession(input: {
		sessionId: string;
		prompt?: string | null;
		metadata?: Record<string, unknown> | null;
		title?: string | null;
	}): Promise<{ updated: boolean; metadata?: Record<string, unknown> | null }> {
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
					Object.keys(manifestMeta).length > 0
						? JSON.parse(JSON.stringify(manifestMeta))
						: undefined;
				this.manifestStore.writeSessionManifest(manifestPath, manifest);
				return { updated: true, metadata: manifest.metadata ?? null };
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

	private isOrphaned(row: SessionRow): boolean {
		if (isNonTerminalSessionStatus(row.status)) {
			return !this.isPidAlive(row.pid);
		}
		return (
			row.status === "failed" &&
			row.metadata?.terminal_marker ===
				UnifiedSessionPersistenceService.STALE_REASON &&
			row.metadata.terminal_marker_at === row.endedAt
		);
	}

	private async reconcileDeadRunningSession(
		row: SessionRow,
	): Promise<SessionRow | undefined> {
		if (
			isNonTerminalSessionStatus(row.status) === false ||
			this.isPidAlive(row.pid)
		) {
			await this.clearStaleFirstSeen(row.sessionId);
			return row;
		}

		const detectedAt = nowIso();
		const reason = UnifiedSessionPersistenceService.STALE_REASON;

		for (let attempt = 0; attempt < OCC_MAX_RETRIES; attempt++) {
			const latest = await this.adapter.getSession(row.sessionId);
			if (!latest) return undefined;
			if (
				isNonTerminalSessionStatus(latest.status) === false ||
				this.isPidAlive(latest.pid)
			) {
				await this.clearStaleFirstSeen(latest.sessionId);
				return latest;
			}

			// Grace window keyed on the persisted first-sight stamp: when we
			// first see this pid dead we record the time in the row metadata
			// so every later process (after a reload/restart) keeps the same
			// clock, then skip the mark until the window has elapsed. The
			// clock deliberately ignores updatedAt/startedAt — an idle
			// session's last write can be arbitrarily old even though its
			// owner just died.
			if (this.staleMarkGraceMs > 0) {
				const nowMs = Date.now();
				const stamped = Number(
					latest.metadata?.[
						UnifiedSessionPersistenceService.STALE_FIRST_SEEN_KEY
					],
				);
				const hasStamp =
					Number.isFinite(stamped) && stamped > 0 && stamped <= nowMs;
				const firstSightMs = hasStamp ? stamped : nowMs;
				if (nowMs - firstSightMs < this.staleMarkGraceMs) {
					if (!hasStamp) {
						await this.persistStaleFirstSeen(latest, firstSightMs);
					}
					this.scheduleStaleRecheck(
						this.staleMarkGraceMs - (nowMs - firstSightMs),
					);
					return latest;
				}
			}

			const rowMetadata = { ...(latest.metadata ?? {}) };
			delete rowMetadata[UnifiedSessionPersistenceService.STALE_FIRST_SEEN_KEY];
			const nextMetadata = {
				...rowMetadata,
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

	/**
	 * Best-effort single-attempt write of the first-sight stamp. If it loses
	 * a race (or fails) the row simply falls back to a fresh window on the
	 * next pass — this never blocks reconciliation.
	 */
	private async persistStaleFirstSeen(
		row: SessionRow,
		stampMs: number,
	): Promise<void> {
		try {
			await this.adapter.updateSession({
				sessionId: row.sessionId,
				metadata: {
					...(row.metadata ?? {}),
					[UnifiedSessionPersistenceService.STALE_FIRST_SEEN_KEY]: stampMs,
				},
				expectedStatusLock: row.statusLock,
			});
		} catch {
			// Bookkeeping only; the in-flight window still holds the row.
		}
	}

	/**
	 * Drop the persisted first-sight stamp once the row is no longer an
	 * orphan (adopted under a live pid or terminated). Without this, a later
	 * death of the new owning pid would find a stale stamp and be marked
	 * immediately, skipping its own grace window.
	 */
	private async clearStaleFirstSeen(sessionId: string): Promise<void> {
		try {
			const current = await this.adapter.getSession(sessionId);
			if (!current) return;
			if (
				isNonTerminalSessionStatus(current.status) &&
				this.isPidAlive(current.pid) === false
			) {
				return; // Still dead — the grace logic owns this row now.
			}
			const meta = current.metadata ?? {};
			if (
				meta[UnifiedSessionPersistenceService.STALE_FIRST_SEEN_KEY] ===
				undefined
			) {
				return;
			}
			const nextMeta = { ...meta };
			delete nextMeta[UnifiedSessionPersistenceService.STALE_FIRST_SEEN_KEY];
			await this.adapter.updateSession({
				sessionId,
				metadata: nextMeta,
				expectedStatusLock: current.statusLock,
			});
		} catch {
			// Best effort; a missed clear just costs one extra grace window.
		}
	}

	/**
	 * One-shot, unref'd re-run of the reconciliation so rows skipped during
	 * the grace window still get marked without depending on another trigger
	 * (history refresh, next startup). If the process exits first, the next
	 * backend init or listSessions reconciles again.
	 */
	private scheduleStaleRecheck(delayMs: number): void {
		if (this.staleRecheckTimer !== undefined) {
			return;
		}
		this.staleRecheckTimer = setTimeout(
			() => {
				this.staleRecheckTimer = undefined;
				void this.reconcileDeadSessions().catch(() => {
					// Best effort: the next listSessions or backend init retries.
				});
			},
			Math.max(50, delayMs),
		);
		this.staleRecheckTimer.unref?.();
	}

	async listSessions(
		limit = 200,
		options: { rootOnly?: boolean } = {},
	): Promise<SessionRow[]> {
		const requestedLimit = Math.max(1, Math.floor(limit));
		const scanLimit = Math.min(requestedLimit * 5, 2000);
		await this.reconcileDeadSessions(scanLimit);

		const rows = (
			await this.adapter.listSessions({
				limit: scanLimit,
				rootOnly: options.rootOnly,
			})
		).slice(0, requestedLimit);
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

	/**
	 * Lightweight, effectively unbounded listing of session ids + metadata
	 * (no manifest reads, no dead-session reconciliation). listSessions caps
	 * its scan at 2000 rows; callers that must see every row — e.g. import
	 * dedup markers — use this instead.
	 */
	async listSessionMetadata(
		limit = Number.MAX_SAFE_INTEGER,
	): Promise<Array<{ sessionId: string; metadata?: Record<string, unknown> }>> {
		const rows = await this.adapter.listSessions({
			limit: Math.max(1, Math.floor(limit)),
		});
		return rows.map((row) => ({
			sessionId: row.sessionId,
			metadata: sanitizeMetadata(row.metadata ?? undefined),
		}));
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

		const indexedRow = await this.adapter.getSession(id);
		const row = indexedRow ?? this.manifestStore.readSessionRowFromManifest(id);
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

		if (!indexedRow) {
			// Restored manifests can contain workspace and artifact paths from another
			// machine. Delete only the canonical directory under the current data root.
			this.manifestStore.artifacts.removeSessionDir(id);
			return { deleted: true };
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
