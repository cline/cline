import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type * as LlmsProviders from "@clinebot/llms";
import type { AgentResult } from "@clinebot/shared";
import { resolveRootSessionId } from "@clinebot/shared";
import { ensureHookLogDir } from "@clinebot/shared/storage";
import { z } from "zod";
import type {
	SubAgentEndContext,
	SubAgentStartContext,
} from "../../extensions/tools/team";
import type { HookEventPayload } from "../../hooks";
import { nowIso } from "../../services/session-artifacts";
import { resolveMetadataWithTitle } from "../../services/session-data";
import type { SessionStatus } from "../../types/common";
import type {
	SessionPersistenceAdapter,
	StoredMessageWithMetadata,
} from "../../types/session";
import {
	deriveSubsessionStatus,
	makeSubSessionId,
	makeTeamTaskSubSessionId,
} from "../models/session-graph";
import type { SessionRow, UpsertSubagentInput } from "../models/session-row";
import type { SessionManifestStore } from "../stores/session-manifest-store";

const SUBSESSION_SOURCE = "subagent";
const SpawnAgentInputSchema = z.looseObject({
	task: z.string().optional(),
	systemPrompt: z.string().optional(),
});

export class TeamChildSessionManager {
	private readonly teamTaskSessionsByAgent = new Map<string, string[]>();
	private readonly teamTaskLastHeartbeatBySession = new Map<string, number>();
	private readonly teamTaskLastProgressLineBySession = new Map<
		string,
		string
	>();

	constructor(
		private readonly adapter: SessionPersistenceAdapter,
		private readonly manifestStore: SessionManifestStore,
		private readonly toPersistedMessages: (
			messages: LlmsProviders.Message[] | undefined,
			result?: AgentResult,
			previousMessages?: LlmsProviders.Message[],
		) => StoredMessageWithMetadata[] | undefined,
		private readonly heartbeatLogIntervalMs: number,
	) {}

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
			hookPath: "",
			messagesPath: opts.messagesPath,
			updatedAt: opts.startedAt,
		};
	}

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
		const artifactPaths = this.manifestStore.artifacts.subagentArtifactPaths(
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
			this.manifestStore.initializeMessagesFile(
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

	async onTeamTaskStart(
		rootSessionId: string,
		agentId: string,
		message: string,
	): Promise<void> {
		const root = await this.adapter.getSession(rootSessionId);
		if (!root) return;
		const sessionId = makeTeamTaskSubSessionId(rootSessionId, agentId);
		const startedAt = nowIso();
		const { messagesPath } = this.manifestStore.artifacts.subagentArtifactPaths(
			sessionId,
			agentId,
		);
		await this.adapter.upsertSession(
			this.buildSubsessionRow(root, {
				sessionId,
				parentSessionId: rootSessionId,
				parentAgentId: "lead",
				agentId,
				prompt: message || `Team task for ${agentId}`,
				startedAt,
				messagesPath,
			}),
		);
		this.manifestStore.initializeMessagesFile(
			sessionId,
			messagesPath,
			startedAt,
		);
		const key = this.teamTaskQueueKey(rootSessionId, agentId);
		const queue = this.teamTaskSessionsByAgent.get(key) ?? [];
		queue.push(sessionId);
		this.teamTaskSessionsByAgent.set(key, queue);
	}

	async onTeamTaskEnd(
		rootSessionId: string,
		agentId: string,
		status: SessionStatus,
		_summary?: string,
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
			await this.manifestStore.persistSessionMessages(
				sessionId,
				persistedMessages,
			);
		}
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
			if (now - last < this.heartbeatLogIntervalMs) {
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
		if (!subSessionId) return;
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
			await this.applySubagentStatusBySessionId(subSessionId, "failed");
			return;
		}
		const reason = context.result?.finishReason ?? "completed";
		await this.applySubagentStatusBySessionId(
			subSessionId,
			reason === "aborted" ? "cancelled" : "completed",
		);
	}

	appendSubagentHookAudit(event: HookEventPayload): void {
		const envPath = process.env.CLINE_HOOKS_LOG_PATH?.trim() || undefined;
		const logPath = envPath ?? join(ensureHookLogDir(), "hooks.jsonl");
		appendFileSync(
			logPath,
			`${JSON.stringify({ ts: nowIso(), ...event })}\n`,
			"utf8",
		);
	}
}
