import type * as LlmsProviders from "@clinebot/llms";
import type {
	ChatRunTurnRequest,
	ChatStartSessionRequest,
	ChatStartSessionResponse,
	ChatTurnResult,
	HubEventEnvelope,
	TeamProgressProjectionEvent,
} from "@clinebot/shared";
import type { CheckpointEntry } from "../../hooks/checkpoint-hooks";
import { NodeHubClient } from "../client";

export interface HubSessionClientOptions {
	address: string;
	clientId?: string;
	clientType?: string;
	displayName?: string;
	workspaceRoot?: string;
	cwd?: string;
	metadata?: Record<string, unknown>;
}

export interface HubSessionRow {
	sessionId: string;
	parentSessionId?: string;
	metadata?: Record<string, unknown>;
	messagesPath?: string;
}

export interface HubStreamEvent {
	sessionId: string;
	eventType: string;
	payload: Record<string, unknown>;
}

export interface HubRestoreRequest {
	sessionId: string;
	checkpointRunCount: number;
	config?: ChatStartSessionRequest;
	restore?: {
		messages?: boolean;
		workspace?: boolean;
	};
}

export interface HubRestoreResponse {
	sessionId?: string;
	startResult?: {
		sessionId: string;
		manifestPath: string;
		messagesPath: string;
	};
	messages?: LlmsProviders.Message[];
	checkpoint: CheckpointEntry;
}

export interface HubEventStreamHandlers {
	onEvent?: (event: HubStreamEvent) => void;
	onError?: (error: Error) => void;
}

export interface HubTeamProgressHandlers {
	onProjection?: (event: TeamProgressProjectionEvent) => void;
	onError?: (error: Error) => void;
}

function cloneRecord(
	value: Record<string, unknown> | undefined,
): Record<string, unknown> {
	return value ? JSON.parse(JSON.stringify(value)) : {};
}

function extractSessionRow(
	payload: Record<string, unknown> | undefined,
): HubSessionRow | undefined {
	const session =
		payload?.session && typeof payload.session === "object"
			? (payload.session as Record<string, unknown>)
			: undefined;
	if (!session) {
		return undefined;
	}
	const metadata =
		session.metadata && typeof session.metadata === "object"
			? cloneRecord(session.metadata as Record<string, unknown>)
			: undefined;
	return {
		sessionId: typeof session.sessionId === "string" ? session.sessionId : "",
		parentSessionId:
			typeof metadata?.parentSessionId === "string"
				? metadata.parentSessionId
				: undefined,
		messagesPath:
			typeof metadata?.messagesPath === "string"
				? metadata.messagesPath
				: undefined,
		metadata,
	};
}

function hubReplyErrorMessage(
	reply: { error?: { message?: string } },
	command: string,
): string {
	return reply.error?.message ?? `hub command failed: ${command}`;
}

function extractCheckpoint(
	payload: Record<string, unknown> | undefined,
): CheckpointEntry {
	const checkpoint = payload?.checkpoint;
	if (
		!checkpoint ||
		typeof checkpoint !== "object" ||
		Array.isArray(checkpoint)
	) {
		throw new Error("hub checkpoint restore returned no checkpoint");
	}
	const record = checkpoint as Partial<CheckpointEntry>;
	if (
		typeof record.ref !== "string" ||
		typeof record.createdAt !== "number" ||
		typeof record.runCount !== "number"
	) {
		throw new Error("hub checkpoint restore returned an invalid checkpoint");
	}
	return record as CheckpointEntry;
}

function mapHubEvent(event: HubEventEnvelope): HubStreamEvent | undefined {
	const sessionId = event.sessionId?.trim();
	if (!sessionId) {
		return undefined;
	}
	switch (event.event) {
		case "iteration.started":
			return {
				sessionId,
				eventType: "runtime.chat.iteration_start",
				payload: cloneRecord(event.payload),
			};
		case "iteration.finished":
			return {
				sessionId,
				eventType: "runtime.chat.iteration_end",
				payload: cloneRecord(event.payload),
			};
		case "assistant.delta":
			return {
				sessionId,
				eventType: "runtime.chat.text_delta",
				payload: cloneRecord(event.payload),
			};
		case "tool.started":
			return {
				sessionId,
				eventType: "runtime.chat.tool_call_start",
				payload: cloneRecord(event.payload),
			};
		case "tool.finished":
			return {
				sessionId,
				eventType: "runtime.chat.tool_call_end",
				payload: cloneRecord(event.payload),
			};
		case "approval.requested":
			return {
				sessionId,
				eventType: "approval.requested",
				payload: cloneRecord(event.payload),
			};
		case "run.aborted":
			return {
				sessionId,
				eventType: "runtime.chat.aborted",
				payload: cloneRecord(event.payload),
			};
		case "run.completed":
			return {
				sessionId,
				eventType: "runtime.chat.completed",
				payload: cloneRecord(event.payload),
			};
		default:
			return undefined;
	}
}

export class HubSessionClient {
	private readonly client: NodeHubClient;
	private metadataApplied = false;

	constructor(private readonly options: HubSessionClientOptions) {
		this.client = new NodeHubClient({
			url: options.address,
			clientId: options.clientId,
			clientType: options.clientType ?? "hub-session-client",
			displayName: options.displayName ?? "hub session client",
			workspaceRoot: options.workspaceRoot,
			cwd: options.cwd,
		});
	}

	private async ensureMetadataApplied(): Promise<void> {
		if (this.metadataApplied || !this.options.metadata) {
			if (!this.options.metadata) {
				await this.client.connect();
			}
			return;
		}
		await this.client.connect();
		await this.client.command("client.update", {
			metadata: this.options.metadata,
		});
		this.metadataApplied = true;
	}

	async connect(): Promise<void> {
		await this.ensureMetadataApplied();
	}

	close(): void {
		this.client.close();
	}

	async dispose(): Promise<void> {
		await this.client.dispose();
	}

	async startRuntimeSession(
		request: ChatStartSessionRequest,
	): Promise<ChatStartSessionResponse> {
		await this.ensureMetadataApplied();
		const reply = await this.client.command("session.create", {
			workspaceRoot: request.workspaceRoot,
			cwd: request.cwd,
			sessionConfig: {
				providerId: request.provider,
				modelId: request.model,
				apiKey: request.apiKey,
				cwd: request.cwd ?? request.workspaceRoot,
				workspaceRoot: request.workspaceRoot,
				systemPrompt: request.systemPrompt ?? "",
				mode: request.mode ?? "act",
				rules: request.rules,
				maxIterations: request.maxIterations,
				enableTools: request.enableTools,
				enableSpawnAgent: request.enableSpawn !== false,
				enableAgentTeams: request.enableTeams !== false,
				disableMcpSettingsTools: request.disableMcpSettingsTools,
				missionLogIntervalSteps: request.missionStepInterval,
				missionLogIntervalMs: request.missionTimeIntervalMs,
			},
			metadata: {
				source: request.source ?? "cli",
				provider: request.provider,
				model: request.model,
				enableTools: request.enableTools,
				enableSpawn: request.enableSpawn,
				enableTeams: request.enableTeams,
				prompt: undefined,
				interactive: request.interactive !== false,
			},
			runtimeOptions: {
				mode: request.mode,
				systemPrompt: request.systemPrompt,
				maxIterations: request.maxIterations,
				enableTools: request.enableTools,
				enableSpawn: request.enableSpawn,
				enableTeams: request.enableTeams,
				autoApproveTools: request.autoApproveTools,
				configExtensions: request.configExtensions,
			},
			modelSelection: {
				provider: request.provider,
				model: request.model,
				apiKey: request.apiKey,
			},
			toolPolicies: request.toolPolicies,
		});
		const row = extractSessionRow(reply.payload);
		if (!row?.sessionId) {
			throw new Error("hub session create returned no session id");
		}
		return {
			sessionId: row.sessionId,
			startResult: {
				sessionId: row.sessionId,
				manifestPath: "",
				messagesPath: row.messagesPath ?? "",
			},
		};
	}

	async sendRuntimeSession(
		sessionId: string,
		request: ChatRunTurnRequest,
	): Promise<{ result?: ChatTurnResult }> {
		await this.ensureMetadataApplied();
		const reply = await this.client.command(
			"session.send_input",
			{
				prompt: request.prompt,
				attachments: request.attachments,
				delivery: request.delivery,
			},
			sessionId,
		);
		return {
			result: reply.payload?.result as ChatTurnResult | undefined,
		};
	}

	async stopRuntimeSession(sessionId: string): Promise<{ applied: boolean }> {
		await this.ensureMetadataApplied();
		await this.client.command("session.detach", { sessionId }, sessionId);
		return { applied: true };
	}

	async abortRuntimeSession(sessionId: string): Promise<{ applied: boolean }> {
		await this.ensureMetadataApplied();
		await this.client.command("run.abort", { sessionId }, sessionId);
		return { applied: true };
	}

	async updateSession(input: {
		sessionId: string;
		metadata?: Record<string, unknown>;
	}): Promise<{ updated: boolean }> {
		await this.ensureMetadataApplied();
		await this.client.command(
			"session.update",
			{
				sessionId: input.sessionId,
				metadata: input.metadata,
			},
			input.sessionId,
		);
		return { updated: true };
	}

	async getSession(sessionId: string): Promise<HubSessionRow | undefined> {
		await this.ensureMetadataApplied();
		const reply = await this.client.command(
			"session.get",
			undefined,
			sessionId,
		);
		return extractSessionRow(reply.payload);
	}

	async readMessages(sessionId: string): Promise<LlmsProviders.Message[]> {
		const target = sessionId.trim();
		if (!target) {
			return [];
		}
		await this.ensureMetadataApplied();
		const reply = await this.client.command(
			"session.messages",
			{ sessionId: target },
			target,
		);
		if (!reply.ok) {
			throw new Error(hubReplyErrorMessage(reply, "session.messages"));
		}
		const messages = reply.payload?.messages;
		return Array.isArray(messages) ? (messages as LlmsProviders.Message[]) : [];
	}

	async restore(input: HubRestoreRequest): Promise<HubRestoreResponse> {
		const sessionId = input.sessionId.trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const restoreMessages = input.restore?.messages !== false;
		if (restoreMessages && !input.config) {
			throw new Error("config is required when restore.messages is true");
		}
		await this.ensureMetadataApplied();
		const request = input.config;
		const reply = await this.client.command(
			"session.restore",
			{
				sessionId,
				checkpointRunCount: input.checkpointRunCount,
				restore: input.restore,
				...(request
					? {
							workspaceRoot: request.workspaceRoot,
							cwd: request.cwd,
							sessionConfig: {
								providerId: request.provider,
								modelId: request.model,
								apiKey: request.apiKey,
								cwd: request.cwd ?? request.workspaceRoot,
								workspaceRoot: request.workspaceRoot,
								systemPrompt: request.systemPrompt ?? "",
								mode: request.mode ?? "act",
								rules: request.rules,
								maxIterations: request.maxIterations,
								enableTools: request.enableTools,
								enableSpawnAgent: request.enableSpawn !== false,
								enableAgentTeams: request.enableTeams !== false,
								disableMcpSettingsTools: request.disableMcpSettingsTools,
								missionLogIntervalSteps: request.missionStepInterval,
								missionLogIntervalMs: request.missionTimeIntervalMs,
							},
							metadata: {
								source: request.source ?? "cli",
								provider: request.provider,
								model: request.model,
								enableTools: request.enableTools,
								enableSpawn: request.enableSpawn,
								enableTeams: request.enableTeams,
								prompt: undefined,
								interactive: request.interactive !== false,
							},
							runtimeOptions: {
								mode: request.mode,
								systemPrompt: request.systemPrompt,
								maxIterations: request.maxIterations,
								enableTools: request.enableTools,
								enableSpawn: request.enableSpawn,
								enableTeams: request.enableTeams,
								autoApproveTools: request.autoApproveTools,
								configExtensions: request.configExtensions,
							},
							modelSelection: {
								provider: request.provider,
								model: request.model,
								apiKey: request.apiKey,
							},
							toolPolicies: request.toolPolicies,
						}
					: {}),
			},
			sessionId,
		);
		if (!reply.ok) {
			throw new Error(hubReplyErrorMessage(reply, "session.restore"));
		}
		const row = extractSessionRow(reply.payload);
		if (restoreMessages && !row?.sessionId) {
			throw new Error("hub checkpoint restore returned no session id");
		}
		const messages = Array.isArray(reply.payload?.messages)
			? (reply.payload.messages as LlmsProviders.Message[])
			: undefined;
		const checkpoint = extractCheckpoint(reply.payload);
		return {
			sessionId: row?.sessionId,
			startResult: row?.sessionId
				? {
						sessionId: row.sessionId,
						manifestPath: "",
						messagesPath: row.messagesPath ?? "",
					}
				: undefined,
			...(messages ? { messages } : {}),
			checkpoint,
		};
	}

	async listSessions(input?: { limit?: number }): Promise<HubSessionRow[]> {
		await this.ensureMetadataApplied();
		const reply = await this.client.command("session.list", {
			limit: input?.limit ?? 200,
		});
		const sessions = Array.isArray(reply.payload?.sessions)
			? (reply.payload?.sessions as Record<string, unknown>[])
			: [];
		return sessions
			.map((session) => extractSessionRow({ session }))
			.filter((row): row is HubSessionRow => Boolean(row?.sessionId));
	}

	async deleteSession(
		sessionId: string,
		deleteCheckpointRefs = true,
	): Promise<boolean> {
		await this.ensureMetadataApplied();
		const reply = await this.client.command("session.delete", {
			sessionId,
			deleteCheckpointRefs,
		});
		return reply.payload?.deleted === true;
	}

	async respondToolApproval(input: {
		approvalId: string;
		approved: boolean;
		reason?: string;
		responderClientId?: string;
	}): Promise<void> {
		await this.ensureMetadataApplied();
		await this.client.command("approval.respond", {
			approvalId: input.approvalId,
			approved: input.approved,
			payload: input.reason ? { reason: input.reason } : undefined,
			responderClientId: input.responderClientId,
		});
	}

	streamEvents(
		input: { clientId?: string; sessionIds?: string[] },
		handlers: HubEventStreamHandlers,
	): () => void {
		const allowed = new Set(
			(input.sessionIds ?? []).map((id) => id.trim()).filter(Boolean),
		);
		const unsubscribe = this.client.subscribe((event: HubEventEnvelope) => {
			const mapped = mapHubEvent(event);
			if (!mapped) {
				return;
			}
			if (allowed.size > 0 && !allowed.has(mapped.sessionId)) {
				return;
			}
			handlers.onEvent?.(mapped);
		});
		void this.ensureMetadataApplied().catch((error) => {
			handlers.onError?.(
				error instanceof Error ? error : new Error(String(error)),
			);
		});
		return unsubscribe;
	}

	streamTeamProgress(
		_input: { clientId?: string },
		handlers: HubTeamProgressHandlers,
	): () => void {
		const unsubscribe = this.client.subscribe((event: HubEventEnvelope) => {
			if (event.event !== "team.progress" || !event.payload) {
				return;
			}
			handlers.onProjection?.(
				event.payload as unknown as TeamProgressProjectionEvent,
			);
		});
		void this.ensureMetadataApplied().catch((error) => {
			handlers.onError?.(
				error instanceof Error ? error : new Error(String(error)),
			);
		});
		return unsubscribe;
	}

	async createSchedule(input: Record<string, unknown>): Promise<any> {
		await this.ensureMetadataApplied();
		const reply = await this.client.command("schedule.create", input);
		return reply.payload?.schedule;
	}

	async listSchedules(_input?: { limit?: number }): Promise<any[]> {
		await this.ensureMetadataApplied();
		const reply = await this.client.command("schedule.list");
		return Array.isArray(reply.payload?.schedules)
			? (reply.payload?.schedules as any[])
			: [];
	}

	async getSchedule(scheduleId: string): Promise<any | undefined> {
		await this.ensureMetadataApplied();
		const reply = await this.client.command("schedule.get", { scheduleId });
		return reply.payload?.schedule;
	}

	async updateSchedule(
		scheduleId: string,
		input: Record<string, unknown>,
	): Promise<any> {
		await this.ensureMetadataApplied();
		const reply = await this.client.command("schedule.update", {
			scheduleId,
			...input,
		});
		return reply.payload?.schedule;
	}

	async pauseSchedule(scheduleId: string): Promise<any> {
		await this.ensureMetadataApplied();
		const reply = await this.client.command("schedule.disable", { scheduleId });
		return reply.payload?.schedule;
	}

	async resumeSchedule(scheduleId: string): Promise<any> {
		await this.ensureMetadataApplied();
		const reply = await this.client.command("schedule.enable", { scheduleId });
		return reply.payload?.schedule;
	}

	async deleteSchedule(scheduleId: string): Promise<boolean> {
		await this.ensureMetadataApplied();
		const reply = await this.client.command("schedule.delete", { scheduleId });
		return reply.payload?.deleted === true;
	}

	async triggerScheduleNow(scheduleId: string): Promise<any> {
		await this.ensureMetadataApplied();
		const reply = await this.client.command("schedule.trigger", { scheduleId });
		return reply.payload?.execution;
	}

	async listScheduleExecutions(
		scheduleId: string,
		limit?: number,
	): Promise<any[]> {
		await this.ensureMetadataApplied();
		const reply = await this.client.command("schedule.list_executions", {
			scheduleId,
			limit,
		});
		return Array.isArray(reply.payload?.executions)
			? (reply.payload?.executions as any[])
			: [];
	}

	async getScheduleStats(): Promise<any> {
		await this.ensureMetadataApplied();
		const reply = await this.client.command("schedule.stats");
		return reply.payload?.stats;
	}

	async getActiveScheduledExecutions(): Promise<any[]> {
		await this.ensureMetadataApplied();
		const reply = await this.client.command("schedule.active");
		return Array.isArray(reply.payload?.executions)
			? (reply.payload?.executions as any[])
			: [];
	}

	async getUpcomingScheduledRuns(limit?: number): Promise<any[]> {
		await this.ensureMetadataApplied();
		const reply = await this.client.command("schedule.upcoming", { limit });
		return Array.isArray(reply.payload?.upcoming)
			? (reply.payload?.upcoming as any[])
			: [];
	}
}
