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
const SpawnAgentInputSchema = z
	.object({
		task: z.string().optional(),
		systemPrompt: z.string().optional(),
	})
	.passthrough();

function stringifyMetadataJson(
	metadata: Record<string, unknown> | null | undefined,
): string | null {
	if (!metadata || Object.keys(metadata).length === 0) {
		return null;
	}
	return JSON.stringify(metadata);
}

function normalizeSessionTitle(title?: string | null): string | undefined {
	const trimmed = title?.trim();
	return trimmed ? trimmed.slice(0, 120) : undefined;
}

function deriveSessionTitleFromPrompt(
	prompt?: string | null,
): string | undefined {
	const normalizedPrompt = normalizeUserInput(prompt ?? "").trim();
	if (!normalizedPrompt) {
		return undefined;
	}
	const firstLine = normalizedPrompt.split("\n")[0]?.trim();
	return normalizeSessionTitle(firstLine);
}

function normalizeMetadataForStorage(
	metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
	if (!metadata) {
		return undefined;
	}
	const next = { ...metadata };
	if (typeof next.title === "string") {
		const normalizedTitle = normalizeSessionTitle(next.title);
		if (normalizedTitle) {
			next.title = normalizedTitle;
		} else {
			delete next.title;
		}
	} else {
		delete next.title;
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

function metadataWithResolvedTitle(input: {
	metadata?: Record<string, unknown> | null;
	title?: string | null;
	prompt?: string | null;
}): Record<string, unknown> | undefined {
	const next = { ...(normalizeMetadataForStorage(input.metadata) ?? {}) };
	const resolvedTitle =
		input.title !== undefined
			? normalizeSessionTitle(input.title)
			: deriveSessionTitleFromPrompt(input.prompt);
	if (resolvedTitle) {
		next.title = resolvedTitle;
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

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

export class UnifiedSessionPersistenceService {
	private readonly teamTaskSessionsByAgent = new Map<string, string[]>();
	protected readonly artifacts: SessionArtifacts;

	constructor(private readonly adapter: SessionPersistenceAdapter) {
		this.artifacts = new SessionArtifacts(() => this.ensureSessionsDir());
	}

	private teamTaskQueueKey(rootSessionId: string, agentId: string): string {
		return `${rootSessionId}::${agentId}`;
	}

	ensureSessionsDir(): string {
		return this.adapter.ensureSessionsDir();
	}

	private sessionTranscriptPath(sessionId: string): string {
		return this.artifacts.sessionTranscriptPath(sessionId);
	}

	private sessionHookPath(sessionId: string): string {
		return this.artifacts.sessionHookPath(sessionId);
	}

	private sessionMessagesPath(sessionId: string): string {
		return this.artifacts.sessionMessagesPath(sessionId);
	}

	private sessionManifestPath(sessionId: string, ensureDir = true): string {
		return this.artifacts.sessionManifestPath(sessionId, ensureDir);
	}

	private async sessionPathFromStore(
		sessionId: string,
		kind: "transcript_path" | "hook_path" | "messages_path",
	): Promise<string | undefined> {
		const row = await this.adapter.getSession(sessionId);
		const value = row?.[kind];
		return typeof value === "string" && value.trim().length > 0
			? value
			: undefined;
	}

	private activeTeamTaskSessionId(
		rootSessionId: string,
		parentAgentId: string,
	): string | undefined {
		const queue = this.teamTaskSessionsByAgent.get(
			this.teamTaskQueueKey(rootSessionId, parentAgentId),
		);
		if (!queue || queue.length === 0) {
			return undefined;
		}
		return queue[queue.length - 1];
	}

	private subagentArtifactPaths(
		rootSessionId: string,
		sessionId: string,
		parentAgentId: string,
		subAgentId: string,
	): {
		transcriptPath: string;
		hookPath: string;
		messagesPath: string;
	} {
		return this.artifacts.subagentArtifactPaths(
			sessionId,
			subAgentId,
			this.activeTeamTaskSessionId(rootSessionId, parentAgentId),
		);
	}

	private writeSessionManifestFile(
		manifestPath: string,
		manifest: SessionManifest,
	): void {
		const parsedManifest = SessionManifestSchema.parse(manifest);
		writeFileSync(
			manifestPath,
			`${JSON.stringify(parsedManifest, null, 2)}\n`,
			"utf8",
		);
	}

	private readSessionManifestFile(sessionId: string): {
		path: string;
		manifest?: SessionManifest;
	} {
		const manifestPath = this.sessionManifestPath(sessionId, false);
		if (!existsSync(manifestPath)) {
			return { path: manifestPath };
		}
		try {
			const manifest = SessionManifestSchema.parse(
				JSON.parse(readFileSync(manifestPath, "utf8")) as SessionManifest,
			);
			return { path: manifestPath, manifest };
		} catch {
			return { path: manifestPath };
		}
	}

	private applyResolvedTitleToRow(row: SessionRowShape): SessionRowShape {
		const existingMetadata =
			typeof row.metadata_json === "string" &&
			row.metadata_json.trim().length > 0
				? (() => {
						try {
							const parsed = JSON.parse(row.metadata_json) as unknown;
							if (
								parsed &&
								typeof parsed === "object" &&
								!Array.isArray(parsed)
							) {
								return parsed as Record<string, unknown>;
							}
						} catch {
							// Ignore malformed metadata payloads.
						}
						return undefined;
					})()
				: undefined;
		const sanitizedMetadata = normalizeMetadataForStorage(existingMetadata);
		const { manifest } = this.readSessionManifestFile(row.session_id);
		const manifestTitle = normalizeSessionTitle(
			typeof manifest?.metadata?.title === "string"
				? (manifest.metadata.title as string)
				: undefined,
		);
		const resolvedMetadata = manifestTitle
			? {
					...(sanitizedMetadata ?? {}),
					title: manifestTitle,
				}
			: sanitizedMetadata;
		return {
			...row,
			metadata_json: stringifyMetadataJson(resolvedMetadata),
		};
	}

	private createRootSessionId(): string {
		return `${Date.now()}_${nanoid(5)}`;
	}

	async createRootSessionWithArtifacts(
		input: CreateRootSessionWithArtifactsInput,
	): Promise<RootSessionArtifacts> {
		const startedAt = input.startedAt ?? nowIso();
		const providedSessionId = input.sessionId.trim();
		const sessionId =
			providedSessionId.length > 0
				? providedSessionId
				: this.createRootSessionId();
		const transcriptPath = this.sessionTranscriptPath(sessionId);
		const hookPath = this.sessionHookPath(sessionId);
		const messagesPath = this.sessionMessagesPath(sessionId);
		const manifestPath = this.sessionManifestPath(sessionId);
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
			metadata: metadataWithResolvedTitle({
				metadata: input.metadata,
				prompt: input.prompt,
			}),
			messages_path: messagesPath,
		});
		const storedMetadata = normalizeMetadataForStorage(manifest.metadata);

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
			metadata_json: stringifyMetadataJson(storedMetadata),
			transcript_path: transcriptPath,
			hook_path: hookPath,
			messages_path: messagesPath,
			updated_at: nowIso(),
		});

		writeFileSync(
			messagesPath,
			`${JSON.stringify({ version: 1, updated_at: startedAt, messages: [] }, null, 2)}\n`,
			"utf8",
		);
		this.writeSessionManifestFile(manifestPath, manifest);
		return {
			manifestPath,
			transcriptPath,
			hookPath,
			messagesPath,
			manifest,
		};
	}

	writeSessionManifest(manifestPath: string, manifest: SessionManifest): void {
		this.writeSessionManifestFile(manifestPath, manifest);
	}

	async updateSessionStatus(
		sessionId: string,
		status: SessionStatus,
		exitCode?: number | null,
	): Promise<{ updated: boolean; endedAt?: string }> {
		for (let attempt = 0; attempt < 4; attempt++) {
			const row = await this.adapter.getSession(sessionId);
			if (!row || typeof row.status_lock !== "number") {
				return { updated: false };
			}
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
		for (let attempt = 0; attempt < 4; attempt++) {
			const row = await this.adapter.getSession(input.sessionId);
			if (!row || typeof row.status_lock !== "number") {
				return { updated: false };
			}
			const sanitizedMetadata =
				input.metadata === undefined
					? undefined
					: normalizeMetadataForStorage(input.metadata);
			const existingMetadata = (() => {
				const raw = row.metadata_json?.trim();
				if (!raw) {
					return undefined;
				}
				try {
					const parsed = JSON.parse(raw) as unknown;
					if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
						return normalizeMetadataForStorage(
							parsed as Record<string, unknown>,
						);
					}
				} catch {
					// Ignore malformed metadata payloads.
				}
				return undefined;
			})();
			const existingTitle = normalizeSessionTitle(
				typeof existingMetadata?.title === "string"
					? (existingMetadata.title as string)
					: undefined,
			);
			const nextTitle =
				input.title !== undefined
					? normalizeSessionTitle(input.title)
					: input.prompt !== undefined
						? deriveSessionTitleFromPrompt(input.prompt)
						: existingTitle;
			const nextMetadata =
				input.metadata !== undefined
					? { ...(sanitizedMetadata ?? {}) }
					: { ...(existingMetadata ?? {}) };
			if (nextTitle) {
				nextMetadata.title = nextTitle;
			} else {
				delete nextMetadata.title;
			}
			const changed = await this.adapter.updateSession({
				sessionId: input.sessionId,
				prompt: input.prompt,
				metadataJson:
					input.metadata === undefined &&
					input.prompt === undefined &&
					input.title === undefined
						? undefined
						: stringifyMetadataJson(nextMetadata),
				title: nextTitle,
				expectedStatusLock: row.status_lock,
			});
			if (!changed.updated) {
				continue;
			}
			const { path: manifestPath, manifest } = this.readSessionManifestFile(
				input.sessionId,
			);
			if (manifest) {
				if (input.prompt !== undefined) {
					manifest.prompt = input.prompt ?? undefined;
				}
				const nextMetadata =
					input.metadata !== undefined
						? { ...(normalizeMetadataForStorage(input.metadata) ?? {}) }
						: { ...(normalizeMetadataForStorage(manifest.metadata) ?? {}) };
				if (nextTitle) {
					nextMetadata.title = nextTitle;
				}
				manifest.metadata =
					Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined;
				this.writeSessionManifestFile(manifestPath, manifest);
			}
			return { updated: true };
		}
		return { updated: false };
	}

	async queueSpawnRequest(event: HookEventPayload): Promise<void> {
		if (event.hookName !== "tool_call" || event.parent_agent_id !== null) {
			return;
		}
		if (event.tool_call?.name !== "spawn_agent") {
			return;
		}
		const rootSessionId = resolveRootSessionId(event.sessionContext);
		if (!rootSessionId) {
			return;
		}
		const parsedInput = SpawnAgentInputSchema.safeParse(event.tool_call.input);
		const task = parsedInput.success ? parsedInput.data.task : undefined;
		const systemPrompt = parsedInput.success
			? parsedInput.data.systemPrompt
			: undefined;
		await this.adapter.enqueueSpawnRequest({
			rootSessionId,
			parentAgentId: event.agent_id,
			task,
			systemPrompt,
		});
	}

	private async readRootSession(
		rootSessionId: string,
	): Promise<SessionRowShape | null> {
		const row = await this.adapter.getSession(rootSessionId);
		return row ?? null;
	}

	private async claimQueuedSpawnTask(
		rootSessionId: string,
		parentAgentId: string,
	): Promise<string | undefined> {
		return await this.adapter.claimSpawnRequest(rootSessionId, parentAgentId);
	}

	async upsertSubagentSession(
		input: UpsertSubagentInput,
	): Promise<string | undefined> {
		const rootSessionId = input.rootSessionId;
		if (!rootSessionId) {
			return undefined;
		}
		const root = await this.readRootSession(rootSessionId);
		if (!root) {
			return undefined;
		}
		const sessionId = makeSubSessionId(rootSessionId, input.agentId);
		const existing = await this.adapter.getSession(sessionId);
		const startedAt = nowIso();
		const artifactPaths = this.subagentArtifactPaths(
			rootSessionId,
			sessionId,
			input.parentAgentId,
			input.agentId,
		);
		let prompt = input.prompt ?? existing?.prompt ?? undefined;
		if (!prompt) {
			prompt =
				(await this.claimQueuedSpawnTask(rootSessionId, input.parentAgentId)) ??
				`Subagent run by ${input.parentAgentId}`;
		}
		if (!existing) {
			await this.adapter.upsertSession({
				session_id: sessionId,
				source: SUBSESSION_SOURCE,
				pid: process.ppid,
				started_at: startedAt,
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
				parent_session_id: rootSessionId,
				parent_agent_id: input.parentAgentId,
				agent_id: input.agentId,
				conversation_id: input.conversationId,
				is_subagent: 1,
				prompt,
				metadata_json: stringifyMetadataJson(
					metadataWithResolvedTitle({ prompt }),
				),
				transcript_path: artifactPaths.transcriptPath,
				hook_path: artifactPaths.hookPath,
				messages_path: artifactPaths.messagesPath,
				updated_at: startedAt,
			});
			writeFileSync(
				artifactPaths.messagesPath,
				`${JSON.stringify({ version: 1, updated_at: startedAt, messages: [] }, null, 2)}\n`,
				"utf8",
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
			metadataJson: stringifyMetadataJson(
				metadataWithResolvedTitle({
					metadata: (() => {
						const raw = existing.metadata_json?.trim();
						if (!raw) {
							return undefined;
						}
						try {
							const parsed = JSON.parse(raw) as unknown;
							if (
								parsed &&
								typeof parsed === "object" &&
								!Array.isArray(parsed)
							) {
								return parsed as Record<string, unknown>;
							}
						} catch {
							// Ignore malformed metadata payloads.
						}
						return undefined;
					})(),
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
		if (!event.parent_agent_id) {
			return undefined;
		}
		const rootSessionId = resolveRootSessionId(event.sessionContext);
		if (!rootSessionId) {
			return undefined;
		}
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

	async appendSubagentHookAudit(
		subSessionId: string,
		event: HookEventPayload,
	): Promise<void> {
		const line = `${JSON.stringify({ ts: nowIso(), ...event })}\n`;
		const path =
			(await this.sessionPathFromStore(subSessionId, "hook_path")) ??
			this.sessionHookPath(subSessionId);
		appendFileSync(path, line, "utf8");
	}

	async appendSubagentTranscriptLine(
		subSessionId: string,
		line: string,
	): Promise<void> {
		if (!line.trim()) {
			return;
		}
		const path =
			(await this.sessionPathFromStore(subSessionId, "transcript_path")) ??
			this.sessionTranscriptPath(subSessionId);
		appendFileSync(path, `${line}\n`, "utf8");
	}

	async persistSessionMessages(
		sessionId: string,
		messages: LlmsProviders.Message[],
		systemPrompt?: string,
	): Promise<void> {
		const path =
			(await this.sessionPathFromStore(sessionId, "messages_path")) ??
			this.sessionMessagesPath(sessionId);
		const payload: {
			version: number;
			updated_at: string;
			systemPrompt?: string;
			messages: LlmsProviders.Message[];
		} = { version: 1, updated_at: nowIso(), messages };
		if (systemPrompt !== undefined && systemPrompt !== "") {
			payload.systemPrompt = systemPrompt;
		}
		writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
	}

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
		if (!row || typeof row.status_lock !== "number") {
			return;
		}
		const ts = nowIso();
		const endedAt = status === "running" ? null : ts;
		const exitCode = status === "failed" ? 1 : 0;
		await this.adapter.updateSession({
			sessionId: subSessionId,
			status,
			endedAt,
			exitCode: status === "running" ? null : exitCode,
			expectedStatusLock: row.status_lock,
		});
	}

	async applyStatusToRunningChildSessions(
		parentSessionId: string,
		status: Exclude<SessionStatus, "running">,
	): Promise<void> {
		if (!parentSessionId) {
			return;
		}
		const rows = await this.adapter.listSessions({
			limit: 2000,
			parentSessionId,
			status: "running",
		});
		for (const row of rows) {
			await this.applySubagentStatusBySessionId(row.session_id, status);
		}
	}

	private async createTeamTaskSubSession(
		rootSessionId: string,
		agentId: string,
		message: string,
	): Promise<string | undefined> {
		const root = await this.readRootSession(rootSessionId);
		if (!root) {
			return undefined;
		}
		const sessionId = makeTeamTaskSubSessionId(rootSessionId, agentId);
		const startedAt = nowIso();
		const transcriptPath = this.sessionTranscriptPath(sessionId);
		const hookPath = this.sessionHookPath(sessionId);
		const messagesPath = this.sessionMessagesPath(sessionId);
		await this.adapter.upsertSession({
			session_id: sessionId,
			source: SUBSESSION_SOURCE,
			pid: process.ppid,
			started_at: startedAt,
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
			parent_session_id: rootSessionId,
			parent_agent_id: "lead",
			agent_id: agentId,
			conversation_id: null,
			is_subagent: 1,
			prompt: message || `Team task for ${agentId}`,
			metadata_json: stringifyMetadataJson(
				metadataWithResolvedTitle({ prompt: message }),
			),
			transcript_path: transcriptPath,
			hook_path: hookPath,
			messages_path: messagesPath,
			updated_at: startedAt,
		});
		writeFileSync(
			messagesPath,
			`${JSON.stringify({ version: 1, updated_at: startedAt, messages: [] }, null, 2)}\n`,
			"utf8",
		);
		await this.appendSubagentTranscriptLine(sessionId, `[start] ${message}`);
		return sessionId;
	}

	async onTeamTaskStart(
		rootSessionId: string,
		agentId: string,
		message: string,
	): Promise<void> {
		const sessionId = await this.createTeamTaskSubSession(
			rootSessionId,
			agentId,
			message,
		);
		if (!sessionId) {
			return;
		}
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
		if (!queue || queue.length === 0) {
			return;
		}
		const sessionId = queue.shift();
		if (queue.length === 0) {
			this.teamTaskSessionsByAgent.delete(key);
		} else {
			this.teamTaskSessionsByAgent.set(key, queue);
		}
		if (!sessionId) {
			return;
		}
		if (messages) {
			await this.persistSessionMessages(sessionId, messages);
		}
		await this.appendSubagentTranscriptLine(
			sessionId,
			summary ?? `[done] ${status}`,
		);
		await this.applySubagentStatusBySessionId(sessionId, status);
	}

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
		if (!subSessionId) {
			return;
		}
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
		if (!subSessionId) {
			return;
		}
		if (context.error) {
			await this.appendSubagentTranscriptLine(
				subSessionId,
				`[error] ${context.error.message}`,
			);
			await this.applySubagentStatusBySessionId(subSessionId, "failed");
			return;
		}
		await this.appendSubagentTranscriptLine(
			subSessionId,
			`[done] ${context.result?.finishReason ?? "completed"}`,
		);
		if (context.result?.finishReason === "aborted") {
			await this.applySubagentStatusBySessionId(subSessionId, "cancelled");
			return;
		}
		await this.applySubagentStatusBySessionId(subSessionId, "completed");
	}

	private isPidAlive(pid: number): boolean {
		if (!Number.isFinite(pid) || pid <= 0) {
			return false;
		}
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

	async listSessions(limit = 200): Promise<SessionRowShape[]> {
		const requestedLimit = Math.max(1, Math.floor(limit));
		const scanLimit = Math.min(requestedLimit * 5, 2000);
		let rows = await this.adapter.listSessions({ limit: scanLimit });
		const staleRunning = rows.filter(
			(row) => row.status === "running" && !this.isPidAlive(row.pid),
		);
		if (staleRunning.length > 0) {
			for (const row of staleRunning) {
				await this.updateSessionStatus(row.session_id, "failed", 1);
			}
			rows = await this.adapter.listSessions({ limit: scanLimit });
		}
		return rows
			.slice(0, requestedLimit)
			.map((row) => this.applyResolvedTitleToRow(row));
	}

	async deleteSession(sessionId: string): Promise<{ deleted: boolean }> {
		const id = sessionId.trim();
		if (!id) {
			throw new Error("session id is required");
		}
		const row = await this.adapter.getSession(id);
		if (!row) {
			return { deleted: false };
		}
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
				unlinkIfExists(this.sessionManifestPath(child.session_id, false));
				this.artifacts.removeSessionDirIfEmpty(child.session_id);
			}
		}
		unlinkIfExists(row.transcript_path);
		unlinkIfExists(row.hook_path);
		unlinkIfExists(row.messages_path);
		unlinkIfExists(this.sessionManifestPath(id, false));
		this.artifacts.removeSessionDirIfEmpty(id);
		return { deleted: true };
	}
}
