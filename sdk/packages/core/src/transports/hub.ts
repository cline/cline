import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type {
	AgentResult,
	SessionRecord as HubSessionRecord,
	HubToolExecutorName,
	JsonValue,
	ToolContext,
} from "@clinebot/shared";
import type { ToolExecutors } from "../extensions/tools";
import type { HookEventPayload } from "../hooks";
import { NodeHubClient } from "../hub/client";
import type {
	RuntimeHost,
	SendSessionInput,
	SessionAccumulatedUsage,
	StartSessionInput,
	StartSessionResult,
} from "../runtime/runtime-host";
import {
	type SessionManifest,
	SessionManifestSchema,
} from "../session/session-manifest";
import { SessionSource, type SessionStatus } from "../types/common";
import type { CoreSessionEvent } from "../types/events";
import type { SessionRecord } from "../types/sessions";
import {
	RuntimeHostEventBus,
	readPersistedMessagesFile,
} from "./runtime-host-support";

function toJsonRecord(
	value: Record<string, unknown> | undefined,
): Record<string, JsonValue | undefined> | undefined {
	if (!value) {
		return undefined;
	}
	return JSON.parse(JSON.stringify(value)) as Record<
		string,
		JsonValue | undefined
	>;
}

function isHubToolExecutorName(value: unknown): value is HubToolExecutorName {
	return (
		value === "readFile" ||
		value === "search" ||
		value === "bash" ||
		value === "webFetch" ||
		value === "editor" ||
		value === "applyPatch" ||
		value === "skills" ||
		value === "askQuestion" ||
		value === "submit"
	);
}

function parseToolContext(value: unknown): ToolContext {
	const payload =
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	return {
		agentId: typeof payload.agentId === "string" ? payload.agentId : "",
		conversationId:
			typeof payload.conversationId === "string" ? payload.conversationId : "",
		iteration: typeof payload.iteration === "number" ? payload.iteration : 0,
		metadata:
			payload.metadata &&
			typeof payload.metadata === "object" &&
			!Array.isArray(payload.metadata)
				? (payload.metadata as Record<string, unknown>)
				: undefined,
	};
}

export interface HubRuntimeHostOptions {
	url: string;
	authToken?: string;
	clientType?: string;
	displayName?: string;
}

function mapStatus(
	status: HubSessionRecord["status"] | undefined,
): SessionStatus {
	switch (status) {
		case "idle":
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		case "aborted":
			return "cancelled";
		default:
			return "running";
	}
}

function toSessionRecord(session: HubSessionRecord): SessionRecord {
	const metadata =
		session.metadata && typeof session.metadata === "object"
			? JSON.parse(JSON.stringify(session.metadata))
			: undefined;
	return {
		sessionId: session.sessionId,
		parentSessionId:
			typeof metadata?.parentSessionId === "string"
				? metadata.parentSessionId
				: undefined,
		agentId:
			session.runtimeSession?.agentId ||
			(typeof metadata?.agentId === "string" ? metadata.agentId : undefined),
		parentAgentId:
			typeof metadata?.parentAgentId === "string"
				? metadata.parentAgentId
				: undefined,
		conversationId:
			typeof metadata?.conversationId === "string"
				? metadata.conversationId
				: undefined,
		isSubagent:
			typeof metadata?.isSubagent === "boolean" ? metadata.isSubagent : false,
		source:
			typeof metadata?.source === "string"
				? metadata.source
				: SessionSource.CORE,
		pid: typeof metadata?.pid === "number" ? metadata.pid : undefined,
		startedAt: new Date(session.createdAt).toISOString(),
		endedAt:
			mapStatus(session.status) === "running"
				? undefined
				: new Date(session.updatedAt).toISOString(),
		exitCode:
			mapStatus(session.status) === "completed"
				? 0
				: mapStatus(session.status) === "failed"
					? 1
					: undefined,
		status: mapStatus(session.status),
		interactive: metadata?.interactive === true,
		provider:
			typeof metadata?.provider === "string" ? metadata.provider : "hub",
		model: typeof metadata?.model === "string" ? metadata.model : "hub",
		cwd: session.cwd?.trim() || session.workspaceRoot,
		workspaceRoot: session.workspaceRoot,
		teamName:
			typeof metadata?.teamName === "string" ? metadata.teamName : undefined,
		enableTools:
			session.runtimeOptions?.enableTools ?? metadata?.enableTools === true,
		enableSpawn:
			session.runtimeOptions?.enableSpawn ?? metadata?.enableSpawn === true,
		enableTeams:
			session.runtimeOptions?.enableTeams ?? metadata?.enableTeams === true,
		prompt: typeof metadata?.prompt === "string" ? metadata.prompt : undefined,
		metadata,
		updatedAt: new Date(session.updatedAt).toISOString(),
		messagesPath:
			typeof metadata?.messagesPath === "string"
				? metadata.messagesPath
				: undefined,
		hookPath:
			typeof metadata?.hookPath === "string" ? metadata.hookPath : undefined,
	};
}

function buildManifest(
	sessionId: string,
	input: StartSessionInput,
	session: HubSessionRecord | undefined,
): SessionManifest {
	const workspaceRoot =
		session?.workspaceRoot?.trim() ||
		input.config.workspaceRoot ||
		input.config.cwd;
	return SessionManifestSchema.parse({
		version: 1,
		session_id: sessionId,
		source: input.source ?? SessionSource.CORE,
		pid: process.pid,
		started_at: new Date(session?.createdAt ?? Date.now()).toISOString(),
		status: mapStatus(session?.status),
		interactive: input.interactive === true,
		provider: input.config.providerId,
		model: input.config.modelId,
		cwd: session?.cwd?.trim() || input.config.cwd,
		workspace_root: workspaceRoot,
		team_name: input.config.teamName,
		enable_tools: input.config.enableTools,
		enable_spawn: input.config.enableSpawnAgent,
		enable_teams: input.config.enableAgentTeams,
		prompt: input.prompt?.trim() || undefined,
		metadata:
			input.sessionMetadata && Object.keys(input.sessionMetadata).length > 0
				? input.sessionMetadata
				: undefined,
	});
}

export class HubRuntimeHost implements RuntimeHost {
	public readonly runtimeAddress: string;
	private readonly client: NodeHubClient;
	private readonly events = new RuntimeHostEventBus();
	private readonly sessionToolExecutors = new Map<
		string,
		Partial<ToolExecutors>
	>();

	constructor(
		options: HubRuntimeHostOptions,
		clientContext?: { workspaceRoot?: string; cwd?: string },
	) {
		this.runtimeAddress = options.url;
		this.client = new NodeHubClient({
			url: options.url,
			authToken: options.authToken,
			clientType: options.clientType ?? "core-hub-runtime",
			displayName: options.displayName ?? "core hub runtime",
			workspaceRoot: clientContext?.workspaceRoot,
			cwd: clientContext?.cwd,
		});
		this.client.subscribe((event) => {
			this.handleHubEvent(event);
		});
	}

	async start(input: StartSessionInput): Promise<StartSessionResult> {
		const advertisedToolExecutors = Object.keys(
			input.localRuntime?.defaultToolExecutors ?? {},
		).filter(isHubToolExecutorName);
		const reply = await this.client.command("session.create", {
			workspaceRoot: input.config.workspaceRoot?.trim() || input.config.cwd,
			cwd: input.config.cwd,
			sessionConfig: toJsonRecord(input.config as Record<string, unknown>),
			metadata: {
				...(input.sessionMetadata ?? {}),
				source: input.source ?? SessionSource.CORE,
				provider: input.config.providerId,
				model: input.config.modelId,
				enableTools: input.config.enableTools,
				enableSpawn: input.config.enableSpawnAgent,
				enableTeams: input.config.enableAgentTeams,
				teamName: input.config.teamName,
				prompt: input.prompt,
				interactive: input.interactive === true,
			},
			runtimeOptions: {
				toolExecutors: advertisedToolExecutors,
			},
			toolPolicies: toJsonRecord(
				input.toolPolicies as Record<string, unknown> | undefined,
			),
			initialMessages: input.initialMessages,
		});
		const session = reply.payload?.session as HubSessionRecord | undefined;
		const sessionId = session?.sessionId?.trim();
		if (!sessionId) {
			throw new Error("Hub runtime did not return a session id.");
		}
		if (input.localRuntime?.defaultToolExecutors) {
			this.sessionToolExecutors.set(
				sessionId,
				input.localRuntime.defaultToolExecutors,
			);
		}

		return {
			sessionId,
			manifest: buildManifest(sessionId, input, session),
			manifestPath: "",
			messagesPath: "",
			result: undefined,
		};
	}

	async send(input: SendSessionInput): Promise<AgentResult | undefined> {
		const reply = await this.client.command(
			"run.start",
			{
				sessionId: input.sessionId,
				input: input.prompt,
				attachments:
					(input.userImages?.length ?? 0) > 0 ||
					(input.userFiles?.length ?? 0) > 0
						? {
								...(input.userImages?.length
									? { userImages: input.userImages }
									: {}),
								...(input.userFiles?.length
									? {
											userFiles: input.userFiles.map((filePath) => ({
												name: basename(filePath),
												content: readFileSync(filePath, "utf8"),
											})),
										}
									: {}),
							}
						: undefined,
			},
			input.sessionId,
		);
		return reply.payload?.result as AgentResult | undefined;
	}

	async getAccumulatedUsage(
		sessionId: string,
	): Promise<SessionAccumulatedUsage | undefined> {
		const reply = await this.client.command(
			"session.get",
			undefined,
			sessionId,
		);
		const session = reply.payload?.session as
			| (HubSessionRecord & { usage?: SessionAccumulatedUsage })
			| undefined;
		return session?.usage ? { ...session.usage } : undefined;
	}

	async abort(sessionId: string, reason?: unknown): Promise<void> {
		await this.client.command(
			"run.abort",
			{ sessionId, reason: typeof reason === "string" ? reason : undefined },
			sessionId,
		);
	}

	async stop(sessionId: string): Promise<void> {
		this.sessionToolExecutors.delete(sessionId);
		await this.client.command("session.detach", { sessionId }, sessionId);
	}

	async dispose(): Promise<void> {
		this.sessionToolExecutors.clear();
		this.client.close();
	}

	async get(sessionId: string): Promise<SessionRecord | undefined> {
		const reply = await this.client.command(
			"session.get",
			undefined,
			sessionId,
		);
		const session = reply.payload?.session as HubSessionRecord | undefined;
		return session ? toSessionRecord(session) : undefined;
	}

	async list(limit = 100): Promise<SessionRecord[]> {
		const reply = await this.client.command("session.list", { limit });
		const sessions =
			(reply.payload?.sessions as HubSessionRecord[] | undefined) ?? [];
		return sessions.map(toSessionRecord);
	}

	async delete(sessionId: string): Promise<boolean> {
		this.sessionToolExecutors.delete(sessionId);
		const reply = await this.client.command("session.delete", { sessionId });
		return reply.payload?.deleted === true;
	}

	async update(
		sessionId: string,
		updates: {
			prompt?: string | null;
			metadata?: Record<string, unknown> | null;
			title?: string | null;
		},
	): Promise<{ updated: boolean }> {
		const metadata: Record<string, unknown> = {
			...(updates.metadata ?? {}),
		};
		if (typeof updates.prompt === "string") {
			metadata.prompt = updates.prompt;
		}
		if (typeof updates.title === "string") {
			metadata.title = updates.title;
		}
		const reply = await this.client.command("session.update", {
			sessionId,
			metadata,
		});
		return { updated: reply.ok };
	}

	async readMessages(
		sessionId: string,
	): Promise<import("@clinebot/llms").Message[]> {
		const session = await this.get(sessionId);
		return readPersistedMessagesFile(session?.messagesPath);
	}

	async handleHookEvent(_payload: HookEventPayload): Promise<void> {
		await this.client.command("session.hook", { payload: _payload });
	}

	subscribe(listener: (event: CoreSessionEvent) => void): () => void {
		void this.client.connect().catch(() => undefined);
		return this.events.subscribe(listener);
	}

	private handleHubEvent(
		event: import("@clinebot/shared").HubEventEnvelope,
	): void {
		const sessionId = event.sessionId?.trim();
		if (event.event === "capability.requested") {
			void this.handleCapabilityRequest(event);
			return;
		}
		if (!sessionId) {
			return;
		}

		switch (event.event) {
			case "assistant.delta": {
				const text =
					typeof event.payload?.text === "string" ? event.payload.text : "";
				if (!text) {
					return;
				}
				this.events.emit({
					type: "agent_event",
					payload: {
						sessionId,
						event: {
							type: "content_start",
							contentType: "text",
							text,
						},
					},
				});
				return;
			}
			case "reasoning.delta": {
				const text =
					typeof event.payload?.text === "string" ? event.payload.text : "";
				const redacted = event.payload?.redacted === true;
				if (!text && !redacted) {
					return;
				}
				this.events.emit({
					type: "agent_event",
					payload: {
						sessionId,
						event: {
							type: "content_start",
							contentType: "reasoning",
							reasoning: text,
							redacted,
						},
					},
				});
				return;
			}
			case "tool.started": {
				this.events.emit({
					type: "agent_event",
					payload: {
						sessionId,
						event: {
							type: "content_start",
							contentType: "tool",
							toolCallId:
								typeof event.payload?.toolCallId === "string"
									? event.payload.toolCallId
									: undefined,
							toolName:
								typeof event.payload?.toolName === "string"
									? event.payload.toolName
									: undefined,
							input: event.payload?.input,
						},
					},
				});
				return;
			}
			case "tool.finished": {
				this.events.emit({
					type: "agent_event",
					payload: {
						sessionId,
						event: {
							type: "content_end",
							contentType: "tool",
							toolCallId:
								typeof event.payload?.toolCallId === "string"
									? event.payload.toolCallId
									: undefined,
							toolName:
								typeof event.payload?.toolName === "string"
									? event.payload.toolName
									: undefined,
							output: event.payload?.output,
							error:
								typeof event.payload?.error === "string"
									? event.payload.error
									: undefined,
						},
					},
				});
				return;
			}
			case "run.started":
			case "session.created":
			case "session.updated":
			case "session.attached":
			case "session.detached": {
				const session = event.payload?.session as HubSessionRecord | undefined;
				this.events.emit({
					type: "status",
					payload: {
						sessionId,
						status: session?.status ?? "running",
					},
				});
				return;
			}
			case "run.completed":
			case "run.aborted": {
				this.sessionToolExecutors.delete(sessionId);
				this.events.emit({
					type: "ended",
					payload: {
						sessionId,
						reason:
							typeof event.payload?.reason === "string"
								? event.payload.reason
								: event.event === "run.aborted"
									? "aborted"
									: "completed",
						ts: event.timestamp ?? Date.now(),
					},
				});
				return;
			}
			default:
				return;
		}
	}

	private async handleCapabilityRequest(
		event: import("@clinebot/shared").HubEventEnvelope,
	): Promise<void> {
		const sessionId = event.sessionId?.trim();
		if (!sessionId) {
			return;
		}
		const targetClientId =
			typeof event.payload?.targetClientId === "string"
				? event.payload.targetClientId
				: undefined;
		if (targetClientId && targetClientId !== this.client.getClientId()) {
			return;
		}
		const requestId =
			typeof event.payload?.requestId === "string"
				? event.payload.requestId
				: "";
		const capabilityName =
			typeof event.payload?.capabilityName === "string"
				? event.payload.capabilityName
				: "";
		if (!requestId || !capabilityName.startsWith("tool_executor.")) {
			return;
		}
		const executorName = capabilityName.slice("tool_executor.".length);
		const executors = this.sessionToolExecutors.get(sessionId);
		const executor = executors?.[executorName as keyof ToolExecutors] as
			| ((...args: unknown[]) => Promise<unknown>)
			| undefined;
		if (typeof executor !== "function") {
			await this.client.command(
				"capability.respond",
				{
					requestId,
					ok: false,
					error: `No executor registered for ${executorName}`,
				},
				sessionId,
			);
			return;
		}
		const payload =
			event.payload?.payload &&
			typeof event.payload.payload === "object" &&
			!Array.isArray(event.payload.payload)
				? (event.payload.payload as Record<string, unknown>)
				: {};
		const args = Array.isArray(payload.args) ? [...payload.args] : [];
		const context = parseToolContext(payload.context);
		try {
			const result = await executor(...args, context);
			await this.client.command(
				"capability.respond",
				{
					requestId,
					ok: true,
					payload: { result },
				},
				sessionId,
			);
		} catch (error) {
			await this.client.command(
				"capability.respond",
				{
					requestId,
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				},
				sessionId,
			);
		}
	}
}
