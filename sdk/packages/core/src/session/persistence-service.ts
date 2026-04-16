import {
	appendFileSync,
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type * as LlmsProviders from "@clinebot/llms";
import type { AgentResult } from "@clinebot/shared";
import { resolveRootSessionId } from "@clinebot/shared";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { HookEventPayload } from "../hooks";
import type { SubAgentEndContext, SubAgentStartContext } from "../team";
import { SessionSource, type SessionStatus } from "../types/common";
import { nowIso, SessionArtifacts, unlinkIfExists } from "./session-artifacts";
import {
	deriveSubsessionStatus,
	makeSubSessionId,
	makeTeamTaskSubSessionId,
} from "./session-graph";
import {
	type SessionManifest,
	SessionManifestSchema,
} from "./session-manifest";
import type {
	CreateRootSessionWithArtifactsInput,
	RootSessionArtifacts,
	SessionRow,
	UpsertSubagentInput,
} from "./session-service";
import {
	buildManifestFromRow,
	buildMessagesFilePayload,
	deriveTitleFromPrompt,
	normalizeStoredMessagesForPersistence,
	normalizeTitle,
	resolveMessagesFileContext,
	resolveMetadataWithTitle,
	sanitizeMetadata,
	withLatestAssistantTurnMetadata,
	withOccRetry,
	writeEmptyMessagesFile,
} from "./utils/helpers";
import type {
	PersistedSessionUpdateInput,
	SessionMessagesArtifactUploader,
	SessionPersistenceAdapter,
	StoredMessageWithMetadata,
} from "./utils/types";

export type { PersistedSessionUpdateInput, SessionPersistenceAdapter };

const SUBSESSION_SOURCE = SessionSource.SUBAGENT;
const OCC_MAX_RETRIES = 4;

const SpawnAgentInputSchema = z.looseObject({
	task: z.string().optional(),
	systemPrompt: z.string().optional(),
});

// ── Service ───────────────────────────────────────────────────────────

export class UnifiedSessionPersistenceService {
	private readonly teamTaskSessionsByAgent = new Map<string, string[]>();
	private readonly teamTaskLastHeartbeatBySession = new Map<string, number>();
	private readonly teamTaskLastProgressLineBySession = new Map<
		string,
		string
	>();
	protected readonly artifacts: SessionArtifacts;
	private readonly messagesArtifactUploader?: SessionMessagesArtifactUploader;
	private static readonly STALE_REASON = "failed_external_process_exit";
	private static readonly STALE_SOURCE = "stale_session_reconciler";
	private static readonly TEAM_HEARTBEAT_LOG_INTERVAL_MS = 30_000;

	constructor(
		private readonly adapter: SessionPersistenceAdapter,
		options: {
			messagesArtifactUploader?: SessionMessagesArtifactUploader;
		} = {},
	) {
		this.artifacts = new SessionArtifacts(() => this.ensureSessionsDir());
		this.messagesArtifactUploader = options.messagesArtifactUploader;
	}

	ensureSessionsDir(): string {
		return this.adapter.ensureSessionsDir();
	}

	private initializeMessagesFile(
		sessionId: string,
		path: string,
		startedAt: string,
	): void {
		writeEmptyMessagesFile(
			path,
			startedAt,
			resolveMessagesFileContext(sessionId),
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

	// ── Manifest I/O ──────────────────────────────────────────────────

	private writeManifestFile(
		manifestPath: string,
		manifest: SessionManifest,
	): void {
		writeFileSync(
			manifestPath,
			`${JSON.stringify(SessionManifestSchema.parse(manifest), null, 2)}\n`,
			"utf8",
		);
	}

	writeSessionManifest(manifestPath: string, manifest: SessionManifest): void {
		this.writeManifestFile(manifestPath, manifest);
	}

	readSessionManifest(sessionId: string): SessionManifest | undefined {
		return this.readManifestFile(sessionId).manifest;
	}

	private readManifestFile(sessionId: string): {
		path: string;
		manifest?: SessionManifest;
	} {
		const manifestPath = this.artifacts.sessionManifestPath(sessionId, false);
		if (!existsSync(manifestPath)) return { path: manifestPath };
		try {
			return {
				path: manifestPath,
				manifest: SessionManifestSchema.parse(
					JSON.parse(readFileSync(manifestPath, "utf8")) as SessionManifest,
				),
			};
		} catch {
			return { path: manifestPath };
		}
	}

	// ── Path resolution ───────────────────────────────────────────────

	private async resolveArtifactPath(
		sessionId: string,
		kind: "transcriptPath" | "hookPath" | "messagesPath",
		fallback: (id: string) => string,
	): Promise<string> {
		const row = await this.adapter.getSession(sessionId);
		const value = row?.[kind];
		return typeof value === "string" && value.trim().length > 0
			? value
			: fallback(sessionId);
	}

	// ── Team task queue ───────────────────────────────────────────────

	private teamTaskQueueKey(rootSessionId: string, agentId: string): string {
		return `${rootSessionId}::${agentId}`;
	}

	private activeTeamTaskSessionId(
		rootSessionId: string,
		parentAgentId: string,
	): string | undefined {
		const queue = this.teamTaskSessionsByAgent.get(
			this.teamTaskQueueKey(rootSessionId, parentAgentId),
		);
		return queue?.at(-1);
	}

	// ── Root session ──────────────────────────────────────────────────

	async createRootSessionWithArtifacts(
		input: CreateRootSessionWithArtifactsInput,
	): Promise<RootSessionArtifacts> {
		const startedAt = input.startedAt ?? nowIso();
		const providedId = input.sessionId.trim();
		const sessionId =
			providedId.length > 0 ? providedId : `${Date.now()}_${nanoid(5)}`;
		const transcriptPath = this.artifacts.sessionTranscriptPath(sessionId);
		const hookPath = this.artifacts.sessionHookPath(sessionId);
		const messagesPath = this.artifacts.sessionMessagesPath(sessionId);
		const manifestPath = this.artifacts.sessionManifestPath(sessionId);

		const metadata = resolveMetadataWithTitle({
			metadata: input.metadata,
			prompt: input.prompt,
		});
		const manifest = SessionManifestSchema.parse({
			version: 1,
			session_id: sessionId,
			source: input.source,
			pid: input.pid,
			started_at: startedAt,
			status: "running",
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
		});

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
			transcriptPath,
			hookPath,
			messagesPath,
			updatedAt: nowIso(),
		});

		this.initializeMessagesFile(sessionId, messagesPath, startedAt);
		this.writeManifestFile(manifestPath, manifest);
		return { manifestPath, transcriptPath, hookPath, messagesPath, manifest };
	}

	// ── Session status updates ────────────────────────────────────────

	async updateSessionStatus(
		sessionId: string,
		status: SessionStatus,
		exitCode?: number | null,
	): Promise<{ updated: boolean; endedAt?: string }> {
		let endedAt: string | undefined;
		const result = await withOccRetry(
			() => this.adapter.getSession(sessionId),
			async (statusLock) => {
				endedAt = nowIso();
				return this.adapter.updateSession({
					sessionId,
					status,
					endedAt,
					exitCode: typeof exitCode === "number" ? exitCode : null,
					expectedStatusLock: statusLock,
				});
			},
			OCC_MAX_RETRIES,
		);
		if (result.updated) {
			if (status === "cancelled") {
				await this.applyStatusToRunningChildSessions(sessionId, "cancelled");
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
					: input.prompt !== undefined
						? deriveTitleFromPrompt(input.prompt)
						: existingTitle;

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

			const { path: manifestPath, manifest } = this.readManifestFile(
				input.sessionId,
			);
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
				this.writeManifestFile(manifestPath, manifest);
			}
			return { updated: true };
		}
		return { updated: false };
	}

	// ── Spawn queue ───────────────────────────────────────────────────

	async queueSpawnRequest(event: HookEventPayload): Promise<void> {
		if (event.hookName !== "tool_call" || event.parent_agent_id !== null)
			return;
		if (event.tool_call?.name !== "spawn_agent") return;

		const rootSessionId = resolveRootSessionId(event.sessionContext);
		if (!rootSessionId) return;

		const parsed = SpawnAgentInputSchema.safeParse(event.tool_call.input);
		await this.adapter.enqueueSpawnRequest({
			rootSessionId,
			parentAgentId: event.agent_id,
			task: parsed.success ? parsed.data.task : undefined,
			systemPrompt: parsed.success ? parsed.data.systemPrompt : undefined,
		});
	}

	// ── Subagent sessions ─────────────────────────────────────────────

	private buildSubsessionRow(
		root: SessionRow,
		opts: {
			sessionId: string;
			parentSessionId: string;
			parentAgentId: string;
			agentId: string;
			conversationId?: string | null;
			prompt: string;
			startedAt: string;
			transcriptPath: string;
			hookPath: string;
			messagesPath: string;
		},
	): SessionRow {
		return {
			sessionId: opts.sessionId,
			source: SUBSESSION_SOURCE,
			pid: process.ppid,
			startedAt: opts.startedAt,
			endedAt: null,
			exitCode: null,
			status: "running",
			statusLock: 0,
			interactive: false,
			provider: root.provider,
			model: root.model,
			cwd: root.cwd,
			workspaceRoot: root.workspaceRoot,
			teamName: root.teamName ?? null,
			enableTools: root.enableTools,
			enableSpawn: root.enableSpawn,
			enableTeams: root.enableTeams,
			parentSessionId: opts.parentSessionId,
			parentAgentId: opts.parentAgentId,
			agentId: opts.agentId,
			conversationId: opts.conversationId ?? null,
			isSubagent: true,
			prompt: opts.prompt,
			metadata: resolveMetadataWithTitle({ prompt: opts.prompt }),
			transcriptPath: opts.transcriptPath,
			hookPath: opts.hookPath,
			messagesPath: opts.messagesPath,
			updatedAt: opts.startedAt,
		};
	}

	async upsertSubagentSession(
		input: UpsertSubagentInput,
	): Promise<string | undefined> {
		const rootSessionId = input.rootSessionId;
		if (!rootSessionId) return undefined;

		const root = await this.adapter.getSession(rootSessionId);
		if (!root) return undefined;

		const sessionId = makeSubSessionId(rootSessionId, input.agentId);
		const existing = await this.adapter.getSession(sessionId);
		const startedAt = nowIso();
		const artifactPaths = this.artifacts.subagentArtifactPaths(
			sessionId,
			input.agentId,
			this.activeTeamTaskSessionId(rootSessionId, input.parentAgentId),
		);

		let prompt = input.prompt ?? existing?.prompt ?? undefined;
		if (!prompt) {
			prompt =
				(await this.adapter.claimSpawnRequest(
					rootSessionId,
					input.parentAgentId,
				)) ?? `Subagent run by ${input.parentAgentId}`;
		}

		if (!existing) {
			await this.adapter.upsertSession(
				this.buildSubsessionRow(root, {
					sessionId,
					parentSessionId: rootSessionId,
					parentAgentId: input.parentAgentId,
					agentId: input.agentId,
					conversationId: input.conversationId,
					prompt,
					startedAt,
					...artifactPaths,
				}),
			);
			this.initializeMessagesFile(
				sessionId,
				artifactPaths.messagesPath,
				startedAt,
			);
			return sessionId;
		}

		await this.adapter.updateSession({
			sessionId,
			setRunning: true,
			parentSessionId: rootSessionId,
			parentAgentId: input.parentAgentId,
			agentId: input.agentId,
			conversationId: input.conversationId,
			prompt: existing.prompt ?? prompt ?? null,
			metadata: resolveMetadataWithTitle({
				metadata: existing.metadata ?? undefined,
				prompt: existing.prompt ?? prompt ?? null,
			}),
			expectedStatusLock: existing.statusLock,
		});
		return sessionId;
	}

	async upsertSubagentSessionFromHook(
		event: HookEventPayload,
	): Promise<string | undefined> {
		if (!event.parent_agent_id) return undefined;

		const rootSessionId = resolveRootSessionId(event.sessionContext);
		if (!rootSessionId) return undefined;

		if (event.hookName === "session_shutdown") {
			const sessionId = makeSubSessionId(rootSessionId, event.agent_id);
			const existing = await this.adapter.getSession(sessionId);
			return existing ? sessionId : undefined;
		}
		return await this.upsertSubagentSession({
			agentId: event.agent_id,
			parentAgentId: event.parent_agent_id,
			conversationId: event.taskId,
			rootSessionId,
		});
	}

	// ── Subagent audit / transcript ───────────────────────────────────

	async appendSubagentHookAudit(
		subSessionId: string,
		event: HookEventPayload,
	): Promise<void> {
		const path = await this.resolveArtifactPath(
			subSessionId,
			"hookPath",
			(id) => this.artifacts.sessionHookPath(id),
		);
		appendFileSync(
			path,
			`${JSON.stringify({ ts: nowIso(), ...event })}\n`,
			"utf8",
		);
	}

	async appendSubagentTranscriptLine(
		subSessionId: string,
		line: string,
	): Promise<void> {
		if (!line.trim()) return;
		const path = await this.resolveArtifactPath(
			subSessionId,
			"transcriptPath",
			(id) => this.artifacts.sessionTranscriptPath(id),
		);
		appendFileSync(path, `${line}\n`, "utf8");
	}

	async persistSessionMessages(
		sessionId: string,
		messages: LlmsProviders.Message[],
		systemPrompt?: string,
	): Promise<void> {
		const path = await this.resolveArtifactPath(
			sessionId,
			"messagesPath",
			(id) => this.artifacts.sessionMessagesPath(id),
		);
		const normalizedMessages = normalizeStoredMessagesForPersistence(
			messages as LlmsProviders.MessageWithMetadata[],
		);
		const payload = buildMessagesFilePayload({
			updatedAt: nowIso(),
			context: resolveMessagesFileContext(sessionId),
			messages: normalizedMessages,
			systemPrompt,
		});
		const contents = `${JSON.stringify(payload, null, 2)}\n`;
		writeFileSync(path, contents, "utf8");
		if (!this.messagesArtifactUploader) {
			return;
		}
		try {
			const row = await this.adapter.getSession(sessionId);
			await this.messagesArtifactUploader.uploadMessagesFile({
				sessionId,
				path,
				contents,
				row,
			});
		} catch (error) {
			console.warn(
				`Failed to upload persisted session messages for ${sessionId}`,
				error,
			);
		}
	}

	// ── Subagent status ───────────────────────────────────────────────

	async applySubagentStatus(
		subSessionId: string,
		event: HookEventPayload,
	): Promise<void> {
		await this.applySubagentStatusBySessionId(
			subSessionId,
			deriveSubsessionStatus(event),
		);
	}

	async applySubagentStatusBySessionId(
		subSessionId: string,
		status: SessionStatus,
	): Promise<void> {
		const row = await this.adapter.getSession(subSessionId);
		if (!row) return;

		const endedAt = status === "running" ? null : nowIso();
		const exitCode = status === "running" ? null : status === "failed" ? 1 : 0;
		await this.adapter.updateSession({
			sessionId: subSessionId,
			status,
			endedAt,
			exitCode,
			expectedStatusLock: row.statusLock,
		});
	}

	async applyStatusToRunningChildSessions(
		parentSessionId: string,
		status: Exclude<SessionStatus, "running">,
	): Promise<void> {
		if (!parentSessionId) return;
		const rows = await this.adapter.listSessions({
			limit: 2000,
			parentSessionId,
			status: "running",
		});
		for (const row of rows) {
			await this.applySubagentStatusBySessionId(row.sessionId, status);
		}
	}

	// ── Team tasks ────────────────────────────────────────────────────

	async onTeamTaskStart(
		rootSessionId: string,
		agentId: string,
		message: string,
	): Promise<void> {
		const root = await this.adapter.getSession(rootSessionId);
		if (!root) return;

		const sessionId = makeTeamTaskSubSessionId(rootSessionId, agentId);
		const startedAt = nowIso();
		const { transcriptPath, hookPath, messagesPath } =
			this.artifacts.subagentArtifactPaths(sessionId, agentId);

		await this.adapter.upsertSession(
			this.buildSubsessionRow(root, {
				sessionId,
				parentSessionId: rootSessionId,
				parentAgentId: "lead",
				agentId,
				prompt: message || `Team task for ${agentId}`,
				startedAt,
				transcriptPath,
				hookPath,
				messagesPath,
			}),
		);
		this.initializeMessagesFile(sessionId, messagesPath, startedAt);
		await this.appendSubagentTranscriptLine(sessionId, `[start] ${message}`);

		const key = this.teamTaskQueueKey(rootSessionId, agentId);
		const queue = this.teamTaskSessionsByAgent.get(key) ?? [];
		queue.push(sessionId);
		this.teamTaskSessionsByAgent.set(key, queue);
	}

	async onTeamTaskEnd(
		rootSessionId: string,
		agentId: string,
		status: SessionStatus,
		summary?: string,
		result?: AgentResult,
		messages?: LlmsProviders.Message[],
	): Promise<void> {
		const key = this.teamTaskQueueKey(rootSessionId, agentId);
		const queue = this.teamTaskSessionsByAgent.get(key);
		if (!queue || queue.length === 0) return;

		const sessionId = queue.shift();
		if (queue.length === 0) this.teamTaskSessionsByAgent.delete(key);
		if (!sessionId) return;

		const teammateMessages = result?.messages ?? messages;
		const persistedMessages = this.toPersistedMessages(
			teammateMessages,
			result,
			messages,
		);
		if (persistedMessages) {
			await this.persistSessionMessages(sessionId, persistedMessages);
		}
		await this.appendSubagentTranscriptLine(
			sessionId,
			summary ?? `[done] ${status}`,
		);
		await this.applySubagentStatusBySessionId(sessionId, status);
		this.teamTaskLastHeartbeatBySession.delete(sessionId);
		this.teamTaskLastProgressLineBySession.delete(sessionId);
	}

	async onTeamTaskProgress(
		rootSessionId: string,
		agentId: string,
		progress: string,
		options?: { kind?: "heartbeat" | "progress" | "text" },
	): Promise<void> {
		const key = this.teamTaskQueueKey(rootSessionId, agentId);
		const sessionId = this.teamTaskSessionsByAgent.get(key)?.[0];
		if (!sessionId) return;

		const trimmed = progress.trim();
		if (!trimmed) return;

		const kind = options?.kind ?? "progress";
		if (kind === "heartbeat") {
			const now = Date.now();
			const last = this.teamTaskLastHeartbeatBySession.get(sessionId) ?? 0;
			if (
				now - last <
				UnifiedSessionPersistenceService.TEAM_HEARTBEAT_LOG_INTERVAL_MS
			) {
				return;
			}
			this.teamTaskLastHeartbeatBySession.set(sessionId, now);
		}

		const line =
			kind === "heartbeat"
				? "[progress] heartbeat"
				: kind === "text"
					? `[progress] text: ${trimmed}`
					: `[progress] ${trimmed}`;
		if (this.teamTaskLastProgressLineBySession.get(sessionId) === line) return;
		this.teamTaskLastProgressLineBySession.set(sessionId, line);
		await this.appendSubagentTranscriptLine(sessionId, line);
	}

	// ── SubAgent lifecycle ────────────────────────────────────────────

	async handleSubAgentStart(
		rootSessionId: string,
		context: SubAgentStartContext,
	): Promise<void> {
		const subSessionId = await this.upsertSubagentSession({
			agentId: context.subAgentId,
			parentAgentId: context.parentAgentId,
			conversationId: context.conversationId,
			prompt: context.input.task,
			rootSessionId,
		});
		if (!subSessionId) return;
		await this.appendSubagentTranscriptLine(
			subSessionId,
			`[start] ${context.input.task}`,
		);
		await this.applySubagentStatusBySessionId(subSessionId, "running");
	}

	async handleSubAgentEnd(
		rootSessionId: string,
		context: SubAgentEndContext,
	): Promise<void> {
		const subSessionId = await this.upsertSubagentSession({
			agentId: context.subAgentId,
			parentAgentId: context.parentAgentId,
			conversationId: context.conversationId,
			prompt: context.input.task,
			rootSessionId,
		});
		if (!subSessionId) return;

		if (context.error) {
			await this.appendSubagentTranscriptLine(
				subSessionId,
				`[error] ${context.error.message}`,
			);
			await this.applySubagentStatusBySessionId(subSessionId, "failed");
			return;
		}
		const reason = context.result?.finishReason ?? "completed";
		await this.appendSubagentTranscriptLine(subSessionId, `[done] ${reason}`);
		await this.applySubagentStatusBySessionId(
			subSessionId,
			reason === "aborted" ? "cancelled" : "completed",
		);
	}

	// ── Stale session reconciliation ──────────────────────────────────

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

			await this.applyStatusToRunningChildSessions(latest.sessionId, "failed");

			const manifest = buildManifestFromRow(latest, {
				status: "failed",
				endedAt: detectedAt,
				exitCode: 1,
				metadata: nextMetadata,
			});
			const { path: manifestPath } = this.readManifestFile(latest.sessionId);
			this.writeManifestFile(manifestPath, manifest);

			appendFileSync(
				latest.hookPath,
				`${JSON.stringify({
					ts: detectedAt,
					hookName: "session_shutdown",
					reason,
					sessionId: latest.sessionId,
					pid: latest.pid,
					source: UnifiedSessionPersistenceService.STALE_SOURCE,
				})}\n`,
				"utf8",
			);
			appendFileSync(
				latest.transcriptPath,
				`[shutdown] ${reason} (pid=${latest.pid})\n`,
				"utf8",
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

	// ── List / reconcile / delete ─────────────────────────────────────

	async listSessions(limit = 200): Promise<SessionRow[]> {
		const requestedLimit = Math.max(1, Math.floor(limit));
		const scanLimit = Math.min(requestedLimit * 5, 2000);
		await this.reconcileDeadSessions(scanLimit);

		const rows = await this.adapter.listSessions({ limit: scanLimit });
		return rows.slice(0, requestedLimit).map((row) => {
			const meta = sanitizeMetadata(row.metadata ?? undefined);
			const { manifest } = this.readManifestFile(row.sessionId);
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
			for (const child of children) {
				unlinkIfExists(child.transcriptPath);
				unlinkIfExists(child.hookPath);
				unlinkIfExists(child.messagesPath);
				unlinkIfExists(
					this.artifacts.sessionManifestPath(child.sessionId, false),
				);
				this.artifacts.removeSessionDirIfEmpty(child.sessionId);
			}
		}

		unlinkIfExists(row.transcriptPath);
		unlinkIfExists(row.hookPath);
		unlinkIfExists(row.messagesPath);
		unlinkIfExists(this.artifacts.sessionManifestPath(id, false));
		if (row.isSubagent) {
			this.artifacts.removeSessionDirIfEmpty(id);
		} else {
			const candidateDirs = new Set<string>([
				this.artifacts.sessionArtifactsDir(id),
			]);
			for (const path of [row.transcriptPath, row.hookPath, row.messagesPath]) {
				if (typeof path === "string" && path.trim().length > 0) {
					candidateDirs.add(dirname(path));
				}
			}
			for (const dir of candidateDirs) {
				this.artifacts.removeDir(dir);
			}
		}
		return { deleted: true };
	}
}
