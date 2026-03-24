import {
	appendFileSync,
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import type {
	HookEventPayload,
	SubAgentEndContext,
	SubAgentStartContext,
} from "@clinebot/agents";
import type { LlmsProviders } from "@clinebot/llms";
import { normalizeUserInput, resolveRootSessionId } from "@clinebot/shared";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { SessionStatus } from "../types/common";
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
	SessionRowShape,
	UpsertSubagentInput,
} from "./session-service";

const SUBSESSION_SOURCE = "cli_subagent";
const MAX_TITLE_LENGTH = 120;
const OCC_MAX_RETRIES = 4;

const SpawnAgentInputSchema = z
	.object({
		task: z.string().optional(),
		systemPrompt: z.string().optional(),
	})
	.passthrough();

// ── Metadata helpers ──────────────────────────────────────────────────

function stringifyMetadata(
	metadata: Record<string, unknown> | null | undefined,
): string | null {
	if (!metadata || Object.keys(metadata).length === 0) return null;
	return JSON.stringify(metadata);
}

function parseMetadataJson(
	raw: string | null | undefined,
): Record<string, unknown> | undefined {
	const trimmed = raw?.trim();
	if (!trimmed) return undefined;
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// Ignore malformed metadata payloads.
	}
	return undefined;
}

function normalizeTitle(title?: string | null): string | undefined {
	const trimmed = title?.trim();
	return trimmed ? trimmed.slice(0, MAX_TITLE_LENGTH) : undefined;
}

function deriveTitleFromPrompt(prompt?: string | null): string | undefined {
	const normalized = normalizeUserInput(prompt ?? "").trim();
	if (!normalized) return undefined;
	return normalizeTitle(normalized.split("\n")[0]?.trim());
}

/** Strip invalid title from metadata, drop empty objects. */
function sanitizeMetadata(
	metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
	if (!metadata) return undefined;
	const next = { ...metadata };
	const title = normalizeTitle(
		typeof next.title === "string" ? next.title : undefined,
	);
	if (title) {
		next.title = title;
	} else {
		delete next.title;
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

/** Resolve title from explicit title, prompt, or existing metadata. */
function resolveMetadataWithTitle(input: {
	metadata?: Record<string, unknown> | null;
	title?: string | null;
	prompt?: string | null;
}): Record<string, unknown> | undefined {
	const base = sanitizeMetadata(input.metadata) ?? {};
	const title =
		input.title !== undefined
			? normalizeTitle(input.title)
			: deriveTitleFromPrompt(input.prompt);
	if (title) base.title = title;
	return Object.keys(base).length > 0 ? base : undefined;
}

// ── File helpers ──────────────────────────────────────────────────────

function writeEmptyMessagesFile(path: string, startedAt: string): void {
	writeFileSync(
		path,
		`${JSON.stringify({ version: 1, updated_at: startedAt, messages: [] }, null, 2)}\n`,
		"utf8",
	);
}

// ── Interfaces ────────────────────────────────────────────────────────

export interface PersistedSessionUpdateInput {
	sessionId: string;
	expectedStatusLock?: number;
	status?: SessionStatus;
	endedAt?: string | null;
	exitCode?: number | null;
	prompt?: string | null;
	metadataJson?: string | null;
	title?: string | null;
	parentSessionId?: string | null;
	parentAgentId?: string | null;
	agentId?: string | null;
	conversationId?: string | null;
	setRunning?: boolean;
}

export interface SessionPersistenceAdapter {
	ensureSessionsDir(): string;
	upsertSession(row: SessionRowShape): Promise<void>;
	getSession(sessionId: string): Promise<SessionRowShape | undefined>;
	listSessions(options: {
		limit: number;
		parentSessionId?: string;
		status?: string;
	}): Promise<SessionRowShape[]>;
	updateSession(
		input: PersistedSessionUpdateInput,
	): Promise<{ updated: boolean; statusLock: number }>;
	deleteSession(sessionId: string, cascade: boolean): Promise<boolean>;
	enqueueSpawnRequest(input: {
		rootSessionId: string;
		parentAgentId: string;
		task?: string;
		systemPrompt?: string;
	}): Promise<void>;
	claimSpawnRequest(
		rootSessionId: string,
		parentAgentId: string,
	): Promise<string | undefined>;
}

// ── Service ───────────────────────────────────────────────────────────

export class UnifiedSessionPersistenceService {
	private readonly teamTaskSessionsByAgent = new Map<string, string[]>();
	private readonly teamTaskLastHeartbeatBySession = new Map<string, number>();
	private readonly teamTaskLastProgressLineBySession = new Map<
		string,
		string
	>();
	protected readonly artifacts: SessionArtifacts;
	private static readonly STALE_REASON = "failed_external_process_exit";
	private static readonly STALE_SOURCE = "stale_session_reconciler";
	private static readonly TEAM_HEARTBEAT_LOG_INTERVAL_MS = 30_000;

	constructor(private readonly adapter: SessionPersistenceAdapter) {
		this.artifacts = new SessionArtifacts(() => this.ensureSessionsDir());
	}

	ensureSessionsDir(): string {
		return this.adapter.ensureSessionsDir();
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

	private buildManifestFromRow(
		row: SessionRowShape,
		overrides?: {
			status?: SessionStatus;
			endedAt?: string | null;
			exitCode?: number | null;
			metadata?: Record<string, unknown>;
		},
	): SessionManifest {
		return SessionManifestSchema.parse({
			version: 1,
			session_id: row.session_id,
			source: row.source,
			pid: row.pid,
			started_at: row.started_at,
			ended_at: overrides?.endedAt ?? row.ended_at ?? undefined,
			exit_code: overrides?.exitCode ?? row.exit_code ?? undefined,
			status: overrides?.status ?? row.status,
			interactive: row.interactive === 1,
			provider: row.provider,
			model: row.model,
			cwd: row.cwd,
			workspace_root: row.workspace_root,
			team_name: row.team_name ?? undefined,
			enable_tools: row.enable_tools === 1,
			enable_spawn: row.enable_spawn === 1,
			enable_teams: row.enable_teams === 1,
			prompt: row.prompt ?? undefined,
			metadata: overrides?.metadata ?? parseMetadataJson(row.metadata_json),
			messages_path: row.messages_path ?? undefined,
		});
	}

	// ── Path resolution ───────────────────────────────────────────────

	private async resolveArtifactPath(
		sessionId: string,
		kind: "transcript_path" | "hook_path" | "messages_path",
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
			session_id: sessionId,
			source: input.source,
			pid: input.pid,
			started_at: startedAt,
			ended_at: null,
			exit_code: null,
			status: "running",
			status_lock: 0,
			interactive: input.interactive ? 1 : 0,
			provider: input.provider,
			model: input.model,
			cwd: input.cwd,
			workspace_root: input.workspaceRoot,
			team_name: input.teamName ?? null,
			enable_tools: input.enableTools ? 1 : 0,
			enable_spawn: input.enableSpawn ? 1 : 0,
			enable_teams: input.enableTeams ? 1 : 0,
			parent_session_id: null,
			parent_agent_id: null,
			agent_id: null,
			conversation_id: null,
			is_subagent: 0,
			prompt: manifest.prompt ?? null,
			metadata_json: stringifyMetadata(sanitizeMetadata(manifest.metadata)),
			transcript_path: transcriptPath,
			hook_path: hookPath,
			messages_path: messagesPath,
			updated_at: nowIso(),
		});

		writeEmptyMessagesFile(messagesPath, startedAt);
		this.writeManifestFile(manifestPath, manifest);
		return { manifestPath, transcriptPath, hookPath, messagesPath, manifest };
	}

	// ── Session status updates ────────────────────────────────────────

	async updateSessionStatus(
		sessionId: string,
		status: SessionStatus,
		exitCode?: number | null,
	): Promise<{ updated: boolean; endedAt?: string }> {
		for (let attempt = 0; attempt < OCC_MAX_RETRIES; attempt++) {
			const row = await this.adapter.getSession(sessionId);
			if (!row || typeof row.status_lock !== "number")
				return { updated: false };

			const endedAt = nowIso();
			const changed = await this.adapter.updateSession({
				sessionId,
				status,
				endedAt,
				exitCode: typeof exitCode === "number" ? exitCode : null,
				expectedStatusLock: row.status_lock,
			});
			if (changed.updated) {
				if (status === "cancelled") {
					await this.applyStatusToRunningChildSessions(sessionId, "cancelled");
				}
				return { updated: true, endedAt };
			}
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
			if (!row || typeof row.status_lock !== "number")
				return { updated: false };

			const existingMeta = parseMetadataJson(row.metadata_json);
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
				metadataJson: hasMetadataChange
					? stringifyMetadata(baseMeta)
					: undefined,
				title: nextTitle,
				expectedStatusLock: row.status_lock,
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
		root: SessionRowShape,
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
	): SessionRowShape {
		return {
			session_id: opts.sessionId,
			source: SUBSESSION_SOURCE,
			pid: process.ppid,
			started_at: opts.startedAt,
			ended_at: null,
			exit_code: null,
			status: "running",
			status_lock: 0,
			interactive: 0,
			provider: root.provider,
			model: root.model,
			cwd: root.cwd,
			workspace_root: root.workspace_root,
			team_name: root.team_name ?? null,
			enable_tools: root.enable_tools,
			enable_spawn: root.enable_spawn,
			enable_teams: root.enable_teams,
			parent_session_id: opts.parentSessionId,
			parent_agent_id: opts.parentAgentId,
			agent_id: opts.agentId,
			conversation_id: opts.conversationId ?? null,
			is_subagent: 1,
			prompt: opts.prompt,
			metadata_json: stringifyMetadata(
				resolveMetadataWithTitle({ prompt: opts.prompt }),
			),
			transcript_path: opts.transcriptPath,
			hook_path: opts.hookPath,
			messages_path: opts.messagesPath,
			updated_at: opts.startedAt,
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
			writeEmptyMessagesFile(artifactPaths.messagesPath, startedAt);
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
			metadataJson: stringifyMetadata(
				resolveMetadataWithTitle({
					metadata: parseMetadataJson(existing.metadata_json),
					prompt: existing.prompt ?? prompt ?? null,
				}),
			),
			expectedStatusLock: existing.status_lock,
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
			"hook_path",
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
			"transcript_path",
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
			"messages_path",
			(id) => this.artifacts.sessionMessagesPath(id),
		);
		const payload: {
			version: number;
			updated_at: string;
			systemPrompt?: string;
			messages: LlmsProviders.Message[];
		} = { version: 1, updated_at: nowIso(), messages };
		if (systemPrompt) payload.systemPrompt = systemPrompt;
		writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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
		if (!row || typeof row.status_lock !== "number") return;

		const endedAt = status === "running" ? null : nowIso();
		const exitCode = status === "running" ? null : status === "failed" ? 1 : 0;
		await this.adapter.updateSession({
			sessionId: subSessionId,
			status,
			endedAt,
			exitCode,
			expectedStatusLock: row.status_lock,
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
			await this.applySubagentStatusBySessionId(row.session_id, status);
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
		const transcriptPath = this.artifacts.sessionTranscriptPath(sessionId);
		const hookPath = this.artifacts.sessionHookPath(sessionId);
		const messagesPath = this.artifacts.sessionMessagesPath(sessionId);

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
		writeEmptyMessagesFile(messagesPath, startedAt);
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
		messages?: LlmsProviders.Message[],
	): Promise<void> {
		const key = this.teamTaskQueueKey(rootSessionId, agentId);
		const queue = this.teamTaskSessionsByAgent.get(key);
		if (!queue || queue.length === 0) return;

		const sessionId = queue.shift();
		if (queue.length === 0) this.teamTaskSessionsByAgent.delete(key);
		if (!sessionId) return;

		if (messages) await this.persistSessionMessages(sessionId, messages);
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
		row: SessionRowShape,
	): Promise<SessionRowShape | undefined> {
		if (row.status !== "running" || this.isPidAlive(row.pid)) return row;

		const detectedAt = nowIso();
		const reason = UnifiedSessionPersistenceService.STALE_REASON;

		for (let attempt = 0; attempt < OCC_MAX_RETRIES; attempt++) {
			const latest = await this.adapter.getSession(row.session_id);
			if (!latest) return undefined;
			if (latest.status !== "running") return latest;

			const nextMetadata = {
				...(parseMetadataJson(latest.metadata_json) ?? {}),
				terminal_marker: reason,
				terminal_marker_at: detectedAt,
				terminal_marker_pid: latest.pid,
				terminal_marker_source: UnifiedSessionPersistenceService.STALE_SOURCE,
			};

			const changed = await this.adapter.updateSession({
				sessionId: latest.session_id,
				status: "failed",
				endedAt: detectedAt,
				exitCode: 1,
				metadataJson: stringifyMetadata(nextMetadata),
				expectedStatusLock: latest.status_lock,
			});
			if (!changed.updated) continue;

			await this.applyStatusToRunningChildSessions(latest.session_id, "failed");

			const manifest = this.buildManifestFromRow(latest, {
				status: "failed",
				endedAt: detectedAt,
				exitCode: 1,
				metadata: nextMetadata,
			});
			const { path: manifestPath } = this.readManifestFile(latest.session_id);
			this.writeManifestFile(manifestPath, manifest);

			// Write termination markers to hook + transcript files
			appendFileSync(
				latest.hook_path,
				`${JSON.stringify({
					ts: detectedAt,
					hookName: "session_shutdown",
					reason,
					sessionId: latest.session_id,
					pid: latest.pid,
					source: UnifiedSessionPersistenceService.STALE_SOURCE,
				})}\n`,
				"utf8",
			);
			appendFileSync(
				latest.transcript_path,
				`[shutdown] ${reason} (pid=${latest.pid})\n`,
				"utf8",
			);

			return {
				...latest,
				status: "failed",
				ended_at: detectedAt,
				exit_code: 1,
				metadata_json: stringifyMetadata(nextMetadata),
				status_lock: changed.statusLock,
				updated_at: detectedAt,
			};
		}
		return await this.adapter.getSession(row.session_id);
	}

	// ── List / reconcile / delete ─────────────────────────────────────

	async listSessions(limit = 200): Promise<SessionRowShape[]> {
		const requestedLimit = Math.max(1, Math.floor(limit));
		const scanLimit = Math.min(requestedLimit * 5, 2000);
		await this.reconcileDeadSessions(scanLimit);

		const rows = await this.adapter.listSessions({ limit: scanLimit });
		return rows.slice(0, requestedLimit).map((row) => {
			const meta = sanitizeMetadata(parseMetadataJson(row.metadata_json));
			const { manifest } = this.readManifestFile(row.session_id);
			const manifestTitle = normalizeTitle(
				typeof manifest?.metadata?.title === "string"
					? (manifest.metadata.title as string)
					: undefined,
			);
			const resolved = manifestTitle
				? { ...(meta ?? {}), title: manifestTitle }
				: meta;
			return { ...row, metadata_json: stringifyMetadata(resolved) };
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

		if (!row.is_subagent) {
			const children = await this.adapter.listSessions({
				limit: 2000,
				parentSessionId: id,
			});
			await this.adapter.deleteSession(id, true);
			for (const child of children) {
				unlinkIfExists(child.transcript_path);
				unlinkIfExists(child.hook_path);
				unlinkIfExists(child.messages_path);
				unlinkIfExists(
					this.artifacts.sessionManifestPath(child.session_id, false),
				);
				this.artifacts.removeSessionDirIfEmpty(child.session_id);
			}
		}

		unlinkIfExists(row.transcript_path);
		unlinkIfExists(row.hook_path);
		unlinkIfExists(row.messages_path);
		unlinkIfExists(this.artifacts.sessionManifestPath(id, false));
		this.artifacts.removeSessionDirIfEmpty(id);
		return { deleted: true };
	}
}
