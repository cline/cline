import http from "node:http";
import { URL } from "node:url";
import type {
	HubClientRecord,
	HubClientRegistration,
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
	SessionRecord as HubSessionRecord,
	HubToolExecutorName,
	JsonValue,
	RuntimeConfigExtensionKind,
	SessionParticipant,
	TeamProgressProjectionEvent,
	ToolApprovalRequest,
	ToolContext,
} from "@clinebot/shared";
import { createSessionId } from "@clinebot/shared";
import { WebSocketServer } from "ws";
import { CronService, type CronServiceOptions } from "../cron/cron-service";
import { HubScheduleCommandService } from "../cron/schedule-command-service";
import {
	type HubScheduleRuntimeHandlers,
	HubScheduleService,
	type HubScheduleServiceOptions,
} from "../cron/schedule-service";
import type { ToolExecutors } from "../extensions/tools";
import { parseHookEventPayload } from "../hooks";
import type {
	RuntimeHost,
	RuntimeSessionConfig,
} from "../runtime/runtime-host";
import { SqliteSessionStore } from "../services/storage/sqlite-session-store";
import { CoreSessionService } from "../session/session-service";
import { LocalRuntimeHost } from "../transports/local";
import { readPersistedMessagesFile } from "../transports/runtime-host-support";
import type { CoreSessionEvent, SessionPendingPrompt } from "../types/events";
import type { SessionRecord as LocalSessionRecord } from "../types/sessions";
import { BrowserWebSocketHubAdapter } from "./browser-websocket";
import { verifyHubConnection } from "./client";
import { resolveDefaultHubPort } from "./defaults";
import {
	clearHubDiscovery,
	createHubServerUrl,
	type HubOwnerContext,
	type HubServerDiscoveryRecord,
	probeHubServer,
	readHubDiscovery,
	resolveHubBuildId,
	resolveHubOwnerContext,
	withHubStartupLock,
	writeHubDiscovery,
} from "./discovery";
import {
	type NativeHubTransport,
	NativeHubTransportAdapter,
} from "./native-transport";

type NodeWebSocketLike = {
	send(data: string): void;
	on(event: "message", listener: (data: unknown) => void): void;
	on(event: "close", listener: () => void): void;
	once(event: "close", listener: () => void): void;
};

type NodeUpgradeSocketLike = {
	destroy(error?: Error): void;
	write(chunk: string): boolean;
	end(): void;
};

type HubSessionState = {
	createdByClientId: string;
	interactive: boolean;
	participants: Map<string, SessionParticipant>;
};

function decodeSocketData(data: unknown): string {
	if (typeof data === "string") {
		return data;
	}
	if (data instanceof Uint8Array) {
		return Buffer.from(data).toString();
	}
	if (data instanceof ArrayBuffer) {
		return Buffer.from(data).toString();
	}
	if (Array.isArray(data)) {
		return Buffer.concat(data.map((chunk) => Buffer.from(chunk))).toString();
	}
	return String(data);
}

function wrapWsSocket(socket: NodeWebSocketLike) {
	return {
		send(data: string): void {
			socket.send(data);
		},
		addEventListener(
			type: "message" | "close",
			listener: (...args: never[]) => void,
		): void {
			if (type === "message") {
				socket.on("message", (data: unknown) => {
					(listener as (event: { data: string }) => void)({
						data: decodeSocketData(data),
					});
				});
				return;
			}
			socket.on("close", listener as () => void);
		},
		removeEventListener(): void {},
	};
}

const RUNTIME_CONFIG_EXTENSION_KINDS = new Set<RuntimeConfigExtensionKind>([
	"rules",
	"skills",
	"plugins",
]);

function parseRuntimeConfigExtensions(
	value: unknown,
): RuntimeConfigExtensionKind[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const extensions = value
		.map((item) => (typeof item === "string" ? item.trim() : ""))
		.filter((item): item is RuntimeConfigExtensionKind =>
			RUNTIME_CONFIG_EXTENSION_KINDS.has(item as RuntimeConfigExtensionKind),
		);
	return [...new Set(extensions)];
}

function rejectUpgradeSocket(socket: NodeUpgradeSocketLike): void {
	try {
		socket.write(
			"HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
		);
		socket.end();
	} catch {
		socket.destroy();
	}
}

function formatHubUptime(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const days = Math.floor(totalSeconds / 86_400);
	const hours = Math.floor((totalSeconds % 86_400) / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);
	const seconds = totalSeconds % 60;
	if (days > 0) {
		return `${days}d ${hours}h`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds}s`;
	}
	return `${seconds}s`;
}

function mapLocalStatusToHubStatus(
	status: LocalSessionRecord["status"],
): HubSessionRecord["status"] {
	switch (status) {
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		case "cancelled":
			return "aborted";
		default:
			return "running";
	}
}

function cloneSessionMetadata(
	session: LocalSessionRecord,
): Record<string, JsonValue | undefined> | undefined {
	const metadata =
		session.metadata && typeof session.metadata === "object"
			? (JSON.parse(JSON.stringify(session.metadata)) as Record<
					string,
					JsonValue | undefined
				>)
			: ({} as Record<string, JsonValue | undefined>);
	if (session.parentSessionId?.trim())
		metadata.parentSessionId = session.parentSessionId;
	if (session.parentAgentId?.trim())
		metadata.parentAgentId = session.parentAgentId;
	if (session.agentId?.trim()) metadata.agentId = session.agentId;
	if (session.conversationId?.trim())
		metadata.conversationId = session.conversationId;
	if (session.messagesPath?.trim())
		metadata.messagesPath = session.messagesPath;
	if (session.prompt?.trim()) metadata.prompt = session.prompt;
	return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function toHubSessionRecord(
	session: LocalSessionRecord,
	state?: HubSessionState,
): HubSessionRecord {
	return {
		sessionId: session.sessionId,
		workspaceRoot: session.workspaceRoot,
		cwd: session.cwd,
		createdAt: Date.parse(session.startedAt),
		updatedAt: Date.parse(session.updatedAt),
		createdByClientId: state?.createdByClientId ?? "hub",
		status: mapLocalStatusToHubStatus(session.status),
		participants: state ? [...state.participants.values()] : [],
		metadata: cloneSessionMetadata(session),
		runtimeOptions: {
			enableTools: session.enableTools,
			enableSpawn: session.enableSpawn,
			enableTeams: session.enableTeams,
			mode:
				typeof session.metadata?.mode === "string"
					? (session.metadata.mode as "act" | "plan" | "yolo")
					: undefined,
			systemPrompt:
				typeof session.metadata?.systemPrompt === "string"
					? session.metadata.systemPrompt
					: undefined,
		},
		runtimeSession: session.agentId
			? {
					agentId: session.agentId,
					team: session.teamName ? { teamId: session.teamName } : undefined,
				}
			: undefined,
	};
}

function eventNameForScheduleCommand(
	command: HubCommandEnvelope["command"],
): HubEventEnvelope["event"] | undefined {
	switch (command) {
		case "schedule.create":
			return "schedule.created";
		case "schedule.update":
		case "schedule.enable":
		case "schedule.disable":
			return "schedule.updated";
		case "schedule.delete":
			return "schedule.deleted";
		case "schedule.trigger":
			return "schedule.triggered";
		default:
			return undefined;
	}
}

function extractAssistantText(content: unknown): string | undefined {
	if (typeof content === "string") {
		const trimmed = content.trim();
		return trimmed || undefined;
	}
	if (!Array.isArray(content)) {
		return undefined;
	}
	const text = content
		.map((part) => {
			if (
				part &&
				typeof part === "object" &&
				"type" in part &&
				(part as { type?: unknown }).type === "text" &&
				"text" in part &&
				typeof (part as { text?: unknown }).text === "string"
			) {
				return (part as { text: string }).text.trim();
			}
			return "";
		})
		.filter(Boolean)
		.join("\n")
		.trim();
	return text || undefined;
}

const MAX_NOTIFICATION_BODY_BYTES = 120;
const NOTIFICATION_BODY_ELLIPSIS = "...";

export function truncateNotificationBody(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		return "";
	}
	if (Buffer.byteLength(trimmed, "utf8") <= MAX_NOTIFICATION_BODY_BYTES) {
		return trimmed;
	}
	const budget =
		MAX_NOTIFICATION_BODY_BYTES -
		Buffer.byteLength(NOTIFICATION_BODY_ELLIPSIS, "utf8");
	if (budget <= 0) {
		return NOTIFICATION_BODY_ELLIPSIS;
	}
	let truncated = "";
	for (const char of trimmed) {
		if (Buffer.byteLength(truncated + char, "utf8") > budget) {
			break;
		}
		truncated += char;
	}
	return `${truncated}${NOTIFICATION_BODY_ELLIPSIS}`;
}

async function buildCompletionNotification(
	session: HubSessionRecord | undefined,
): Promise<{
	title: string;
	body: string;
	severity: "info";
}> {
	const sessionId = session?.sessionId?.trim() || "unknown";
	const messagesPath =
		typeof session?.metadata?.messagesPath === "string"
			? session.metadata.messagesPath
			: undefined;
	const messages = await readPersistedMessagesFile(messagesPath);
	const latestAssistantText = [...messages]
		.reverse()
		.find((message) => message.role === "assistant");
	const assistantReply = latestAssistantText
		? extractAssistantText(latestAssistantText.content)
		: undefined;
	const workspaceRoot = session?.workspaceRoot?.trim() || "workspace";
	const fallback =
		typeof session?.metadata?.prompt === "string"
			? session.metadata.prompt.trim()
			: workspaceRoot;
	return {
		title: `Task completed (${sessionId})`,
		body: truncateNotificationBody(
			assistantReply && assistantReply.length > 0
				? assistantReply
				: fallback.length > 0
					? fallback
					: workspaceRoot,
		),
		severity: "info",
	};
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

function formatHubStartupError(
	error: unknown,
	context: {
		host: string;
		port: number;
		pathname: string;
	},
): Error {
	const code =
		error &&
		typeof error === "object" &&
		"code" in error &&
		typeof (error as { code?: unknown }).code === "string"
			? (error as { code: string }).code
			: undefined;
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "Unknown startup error";
	const details = `Failed to start hub server on ${context.host}:${context.port}${context.pathname}: ${message}`;
	const wrapped = new Error(code ? `${details} (${code})` : details);
	if (code) {
		(error as Error & { code?: string }).code = code;
		(wrapped as Error & { code?: string }).code = code;
	}
	if (error instanceof Error && error.stack) {
		wrapped.stack = `${wrapped.name}: ${wrapped.message}\nCaused by: ${error.stack}`;
	}
	return wrapped;
}

function isAddressInUseError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as Error & { code?: string }).code === "EADDRINUSE"
	);
}

function serializeToolContext(context: ToolContext): Record<string, unknown> {
	return {
		agentId: context.agentId,
		conversationId: context.conversationId,
		iteration: context.iteration,
		metadata: context.metadata,
	};
}

function createCapabilityBackedToolExecutors(
	targetClientId: string,
	executors: HubToolExecutorName[],
	requestCapability: (
		sessionId: string,
		capabilityName: string,
		payload: Record<string, unknown>,
		targetClientId: string,
	) => Promise<Record<string, unknown> | undefined>,
): Partial<ToolExecutors> {
	const available = new Set(executors);
	const invoke = async (
		executor: HubToolExecutorName,
		args: unknown[],
		context: ToolContext,
	): Promise<unknown> => {
		const response = await requestCapability(
			context.conversationId,
			`tool_executor.${executor}`,
			{
				executor,
				args,
				context: serializeToolContext(context),
			},
			targetClientId,
		);
		return response?.result;
	};

	return {
		...(available.has("readFile")
			? {
					readFile: async (request, context) =>
						(await invoke("readFile", [request], context)) as Awaited<
							ReturnType<NonNullable<ToolExecutors["readFile"]>>
						>,
				}
			: {}),
		...(available.has("search")
			? {
					search: async (query, cwd, context) =>
						String((await invoke("search", [query, cwd], context)) ?? ""),
				}
			: {}),
		...(available.has("bash")
			? {
					bash: async (command, cwd, context) =>
						String((await invoke("bash", [command, cwd], context)) ?? ""),
				}
			: {}),
		...(available.has("webFetch")
			? {
					webFetch: async (url, prompt, context) =>
						String((await invoke("webFetch", [url, prompt], context)) ?? ""),
				}
			: {}),
		...(available.has("editor")
			? {
					editor: async (input, cwd, context) =>
						String((await invoke("editor", [input, cwd], context)) ?? ""),
				}
			: {}),
		...(available.has("applyPatch")
			? {
					applyPatch: async (input, cwd, context) =>
						String((await invoke("applyPatch", [input, cwd], context)) ?? ""),
				}
			: {}),
		...(available.has("skills")
			? {
					skills: async (skill, args, context) =>
						String((await invoke("skills", [skill, args], context)) ?? ""),
				}
			: {}),
		...(available.has("askQuestion")
			? {
					askQuestion: async (question, options, context) =>
						String(
							(await invoke("askQuestion", [question, options], context)) ?? "",
						),
				}
			: {}),
		...(available.has("submit")
			? {
					submit: async (summary, verified, context) =>
						String(
							(await invoke("submit", [summary, verified], context)) ?? "",
						),
				}
			: {}),
	};
}

/** @internal Exported for unit testing fetch/runtime wiring. */
export class HubServerTransport implements NativeHubTransport {
	private readonly clients = new Map<string, HubClientRecord>();
	private readonly listeners = new Map<
		string,
		Set<{ sessionId?: string; listener: (event: HubEventEnvelope) => void }>
	>();
	private readonly sessionState = new Map<string, HubSessionState>();
	private readonly pendingApprovals = new Map<
		string,
		{
			sessionId: string;
			resolve: (result: { approved: boolean; reason?: string }) => void;
		}
	>();
	private readonly pendingCapabilityRequests = new Map<
		string,
		{
			sessionId: string;
			capabilityName: string;
			resolve: (result: {
				ok: boolean;
				payload?: Record<string, unknown>;
				error?: string;
			}) => void;
		}
	>();
	private readonly suppressNextTerminalEventBySession = new Map<
		string,
		string
	>();
	private readonly schedules: HubScheduleService;
	private readonly scheduleCommands: HubScheduleCommandService;
	private readonly cronService?: CronService;
	private readonly sessionHost: RuntimeHost;
	private readonly hubId = createSessionId("hub_");
	private readonly startedAtMs = Date.now();

	constructor(readonly options: HubWebSocketServerOptions) {
		this.sessionHost =
			options.sessionHost ??
			new LocalRuntimeHost({
				sessionService: new CoreSessionService(new SqliteSessionStore()),
				fetch: options.fetch,
			});
		this.schedules = new HubScheduleService({
			...options.scheduleOptions,
			runtimeHandlers: options.runtimeHandlers,
			eventPublisher: (eventType, payload) => {
				const mapped =
					eventType === "schedule.execution.completed"
						? "schedule.execution_completed"
						: eventType === "schedule.execution.failed"
							? "schedule.execution_failed"
							: undefined;
				if (!mapped) {
					return;
				}
				this.publish({
					version: "v1",
					event: mapped,
					eventId: createSessionId("hevt_"),
					timestamp: Date.now(),
					payload:
						payload && typeof payload === "object"
							? (payload as Record<string, unknown>)
							: undefined,
				});
			},
		});
		this.scheduleCommands = new HubScheduleCommandService(this.schedules);
		if (options.cronOptions) {
			this.cronService = new CronService({
				runtimeHandlers: options.runtimeHandlers,
				...options.cronOptions,
			});
		}
		this.sessionHost.subscribe((event) => {
			void this.handleSessionEvent(event).catch((error) => {
				logHubBoundaryError("session event handling failed", error);
			});
		});
	}

	getCronService(): CronService | undefined {
		return this.cronService;
	}

	getHubId(): string {
		return this.hubId;
	}

	async start(): Promise<void> {
		await this.schedules.start();
		if (this.cronService) {
			try {
				await this.cronService.start();
			} catch (err) {
				console.error("[hub] cron service start failed", err);
			}
		}
	}

	async stop(): Promise<void> {
		for (const approvalId of this.pendingApprovals.keys()) {
			this.resolvePendingApproval(approvalId, {
				approved: false,
				reason: "Hub shutting down before approval was resolved.",
			});
		}
		for (const pending of this.pendingCapabilityRequests.values()) {
			pending.resolve({
				ok: false,
				error: "Hub shutting down before capability request was resolved.",
			});
		}
		this.pendingCapabilityRequests.clear();
		await this.sessionHost.dispose("hub_server_stop");
		await this.schedules.dispose();
		if (this.cronService) {
			try {
				await this.cronService.dispose();
			} catch (err) {
				console.error("[hub] cron service stop failed", err);
			}
		}
	}

	async handleCommand(envelope: HubCommandEnvelope): Promise<HubReplyEnvelope> {
		const uptimeMs = Date.now() - this.startedAtMs;
		console.error(
			`[hub] command=${envelope.command} uptime=${formatHubUptime(uptimeMs)} client=${envelope.clientId ?? "unknown"} session=${envelope.sessionId ?? "-"}`,
		);
		switch (envelope.command) {
			case "client.register":
				return this.handleClientRegister(envelope);
			case "client.update":
				return this.handleClientUpdate(envelope);
			case "client.unregister":
				return this.handleClientUnregister(envelope);
			case "client.list":
				return {
					version: envelope.version,
					requestId: envelope.requestId,
					ok: true,
					payload: { clients: [...this.clients.values()] },
				};
			case "session.create":
				return await this.handleSessionCreate(envelope);
			case "session.attach":
				return await this.handleSessionAttach(envelope);
			case "session.detach":
				return await this.handleSessionDetach(envelope);
			case "session.get":
				return await this.handleSessionGet(envelope);
			case "session.messages":
				return await this.handleSessionMessages(envelope);
			case "session.list":
				return await this.handleSessionList(envelope);
			case "session.update":
				return await this.handleSessionUpdate(envelope);
			case "session.pending_prompts":
				return await this.handleSessionPendingPrompts(envelope);
			case "session.update_pending_prompt":
				return await this.handleSessionUpdatePendingPrompt(envelope);
			case "session.remove_pending_prompt":
				return await this.handleSessionRemovePendingPrompt(envelope);
			case "session.delete":
				return await this.handleSessionDelete(envelope);
			case "session.hook":
				return await this.handleSessionHook(envelope);
			case "run.start":
			case "session.send_input":
				return await this.handleSessionInput(envelope);
			case "run.abort":
				return await this.handleRunAbort(envelope);
			case "capability.request":
				return await this.handleCapabilityRequest(envelope);
			case "approval.respond":
				return await this.handleApprovalRespond(envelope);
			case "capability.respond":
				return await this.handleCapabilityRespond(envelope);
			case "ui.notify":
				this.publish(this.buildEvent("ui.notify", envelope.payload ?? {}));
				return {
					version: envelope.version,
					requestId: envelope.requestId,
					ok: true,
				};
			case "ui.show_window":
				this.publish(this.buildEvent("ui.show_window", envelope.payload ?? {}));
				return {
					version: envelope.version,
					requestId: envelope.requestId,
					ok: true,
				};
			default: {
				const reply = await this.scheduleCommands.handleCommand(envelope);
				if (reply.ok) {
					const event = eventNameForScheduleCommand(envelope.command);
					if (event) {
						this.publish({
							version: "v1",
							event,
							eventId: createSessionId("hevt_"),
							timestamp: Date.now(),
							payload: reply.payload,
						});
					}
				}
				return reply;
			}
		}
	}

	private handleClientRegister(envelope: HubCommandEnvelope): HubReplyEnvelope {
		const payload = envelope.payload as HubClientRegistration | undefined;
		const clientId =
			payload?.clientId?.trim() ||
			envelope.clientId?.trim() ||
			createSessionId("client_");
		this.clients.set(clientId, {
			clientId,
			clientType: payload?.clientType ?? "unknown",
			displayName: payload?.displayName,
			actorKind: payload?.actorKind ?? "client",
			connectedAt: Date.now(),
			lastSeenAt: Date.now(),
			transport: payload?.transport ?? "native",
			capabilities: payload?.capabilities ?? [],
			metadata: payload?.metadata,
			workspaceContext: payload?.workspaceContext,
		});
		this.publish(
			this.buildEvent("hub.client.registered", {
				clientId,
				clientType: payload?.clientType ?? "unknown",
				displayName: payload?.displayName,
				connectedAt: Date.now(),
			}),
		);
		return {
			version: envelope.version,
			requestId: envelope.requestId,
			ok: true,
			payload: { clientId },
		};
	}

	private handleClientUpdate(envelope: HubCommandEnvelope): HubReplyEnvelope {
		const clientId = envelope.clientId?.trim();
		const client = clientId ? this.clients.get(clientId) : undefined;
		if (!clientId || !client) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "client_not_found",
					message: "Client is not registered with this hub.",
				},
			};
		}
		const metadata =
			envelope.payload?.metadata &&
			typeof envelope.payload.metadata === "object" &&
			!Array.isArray(envelope.payload.metadata)
				? (envelope.payload.metadata as Record<string, JsonValue | undefined>)
				: undefined;
		client.lastSeenAt = Date.now();
		if (metadata) {
			client.metadata = JSON.parse(JSON.stringify(metadata)) as Record<
				string,
				JsonValue | undefined
			>;
		}
		return {
			version: envelope.version,
			requestId: envelope.requestId,
			ok: true,
		};
	}

	private handleClientUnregister(
		envelope: HubCommandEnvelope,
	): HubReplyEnvelope {
		const clientId = envelope.clientId?.trim();
		if (clientId) {
			this.clients.delete(clientId);
			this.listeners.delete(clientId);
		}
		if (clientId) {
			this.publish(this.buildEvent("hub.client.disconnected", { clientId }));
		}
		return {
			version: envelope.version,
			requestId: envelope.requestId,
			ok: true,
		};
	}

	private buildEvent(
		event: HubEventEnvelope["event"],
		payload?: Record<string, unknown>,
		sessionId?: string,
	): HubEventEnvelope {
		return {
			version: "v1",
			event,
			eventId: createSessionId("hevt_"),
			sessionId,
			timestamp: Date.now(),
			payload,
		};
	}

	private async readHubSessionRecord(
		sessionId: string,
	): Promise<HubSessionRecord | undefined> {
		const session = await this.sessionHost.get(sessionId);
		if (!session) {
			return undefined;
		}
		return toHubSessionRecord(session, this.sessionState.get(sessionId));
	}

	private ensureSessionState(
		sessionId: string,
		clientId: string,
		role: SessionParticipant["role"],
		options: { interactive?: boolean } = {},
	): HubSessionState {
		const existing = this.sessionState.get(sessionId);
		if (existing) {
			if (options.interactive !== undefined) {
				existing.interactive = options.interactive;
			}
			if (!existing.participants.has(clientId)) {
				existing.participants.set(clientId, {
					clientId,
					attachedAt: Date.now(),
					role,
				});
			}
			return existing;
		}
		const state: HubSessionState = {
			createdByClientId: clientId,
			interactive: options.interactive ?? true,
			participants: new Map([
				[
					clientId,
					{
						clientId,
						attachedAt: Date.now(),
						role,
					},
				],
			]),
		};
		this.sessionState.set(sessionId, state);
		return state;
	}

	private async requestCapability(
		sessionId: string,
		capabilityName: string,
		payload: Record<string, unknown>,
		targetClientId: string,
	): Promise<Record<string, unknown> | undefined> {
		const requestId = createSessionId("capreq_");
		return await new Promise((resolve, reject) => {
			this.pendingCapabilityRequests.set(requestId, {
				sessionId,
				capabilityName,
				resolve: (result) => {
					if (!result.ok) {
						reject(
							new Error(
								result.error ||
									`Capability ${capabilityName} was rejected by ${targetClientId}.`,
							),
						);
						return;
					}
					resolve(result.payload);
				},
			});
			this.publish(
				this.buildEvent(
					"capability.requested",
					{
						requestId,
						targetClientId,
						capabilityName,
						payload,
					},
					sessionId,
				),
			);
		});
	}

	private async handleSessionCreate(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		const payload =
			envelope.payload && typeof envelope.payload === "object"
				? envelope.payload
				: {};
		const metadata =
			payload.metadata && typeof payload.metadata === "object"
				? JSON.parse(JSON.stringify(payload.metadata))
				: {};
		const sessionConfig =
			payload.sessionConfig && typeof payload.sessionConfig === "object"
				? (JSON.parse(
						JSON.stringify(payload.sessionConfig),
					) as Partial<RuntimeSessionConfig>)
				: undefined;
		const runtimeOptions =
			payload.runtimeOptions && typeof payload.runtimeOptions === "object"
				? (payload.runtimeOptions as Record<string, unknown>)
				: {};
		if (typeof sessionConfig?.mode === "string") {
			metadata.mode = sessionConfig.mode;
		} else if (typeof runtimeOptions.mode === "string") {
			metadata.mode = runtimeOptions.mode;
		}
		if (typeof sessionConfig?.systemPrompt === "string") {
			metadata.systemPrompt = sessionConfig.systemPrompt;
		} else if (typeof runtimeOptions.systemPrompt === "string") {
			metadata.systemPrompt = runtimeOptions.systemPrompt;
		}
		if (sessionConfig?.checkpoint?.enabled === true) {
			metadata.checkpointEnabled = true;
		} else if (runtimeOptions.checkpointEnabled === true) {
			metadata.checkpointEnabled = true;
		}
		const modelSelection =
			payload.modelSelection && typeof payload.modelSelection === "object"
				? (payload.modelSelection as Record<string, unknown>)
				: {};
		const workspaceRoot =
			typeof payload.workspaceRoot === "string" && payload.workspaceRoot.trim()
				? payload.workspaceRoot.trim()
				: typeof payload.cwd === "string" && payload.cwd.trim()
					? payload.cwd.trim()
					: "";
		if (!workspaceRoot) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "invalid_session_create",
					message: "session.create requires workspaceRoot or cwd",
				},
			};
		}
		const clientId = envelope.clientId?.trim() || "hub-client";
		const advertisedToolExecutors = Array.isArray(runtimeOptions.toolExecutors)
			? runtimeOptions.toolExecutors.filter(isHubToolExecutorName)
			: [];
		const configExtensions = parseRuntimeConfigExtensions(
			runtimeOptions.configExtensions,
		);
		const started = await this.sessionHost.start({
			source: typeof metadata.source === "string" ? metadata.source : undefined,
			interactive: metadata.interactive !== false,
			sessionMetadata:
				Object.keys(metadata as Record<string, unknown>).length > 0
					? (metadata as Record<string, unknown>)
					: undefined,
			initialMessages: Array.isArray(payload.initialMessages)
				? (payload.initialMessages as never[])
				: undefined,
			localRuntime: {
				modelCatalogDefaults: {
					loadLatestOnInit: true,
					loadPrivateOnAuth: true,
				},
				configExtensions,
				defaultToolExecutors: createCapabilityBackedToolExecutors(
					clientId,
					advertisedToolExecutors,
					async (
						sessionId,
						capabilityName,
						capabilityPayload,
						targetClientId,
					) =>
						await this.requestCapability(
							sessionId,
							capabilityName,
							capabilityPayload,
							targetClientId,
						),
				),
			},
			requestToolApproval: async (request: ToolApprovalRequest) => {
				return await this.requestToolApproval(request);
			},
			config: {
				...(sessionConfig ?? {}),
				providerId:
					sessionConfig?.providerId ??
					(typeof modelSelection.provider === "string"
						? modelSelection.provider
						: typeof metadata.provider === "string"
							? metadata.provider
							: "hub"),
				modelId:
					sessionConfig?.modelId ??
					(typeof modelSelection.model === "string"
						? modelSelection.model
						: typeof metadata.model === "string"
							? metadata.model
							: "hub"),
				apiKey:
					sessionConfig?.apiKey ??
					(typeof modelSelection.apiKey === "string"
						? modelSelection.apiKey
						: undefined),
				cwd:
					sessionConfig?.cwd ??
					(typeof payload.cwd === "string" && payload.cwd.trim()
						? payload.cwd.trim()
						: workspaceRoot),
				workspaceRoot: sessionConfig?.workspaceRoot ?? workspaceRoot,
				systemPrompt:
					sessionConfig?.systemPrompt ??
					(typeof runtimeOptions.systemPrompt === "string"
						? runtimeOptions.systemPrompt
						: ""),
				mode:
					sessionConfig?.mode ??
					(runtimeOptions.mode === "plan" || runtimeOptions.mode === "yolo"
						? runtimeOptions.mode
						: "act"),
				maxIterations:
					sessionConfig?.maxIterations ??
					(typeof runtimeOptions.maxIterations === "number"
						? runtimeOptions.maxIterations
						: undefined),
				enableTools:
					sessionConfig?.enableTools ?? runtimeOptions.enableTools !== false,
				enableSpawnAgent:
					sessionConfig?.enableSpawnAgent ??
					runtimeOptions.enableSpawn !== false,
				enableAgentTeams:
					sessionConfig?.enableAgentTeams ??
					runtimeOptions.enableTeams !== false,
				checkpoint:
					sessionConfig?.checkpoint ??
					(runtimeOptions.checkpointEnabled === true
						? { enabled: true }
						: undefined),
				teamName:
					sessionConfig?.teamName ??
					(typeof metadata.teamName === "string"
						? metadata.teamName
						: undefined),
			},
			toolPolicies:
				payload.toolPolicies &&
				typeof payload.toolPolicies === "object" &&
				!Array.isArray(payload.toolPolicies)
					? (JSON.parse(JSON.stringify(payload.toolPolicies)) as Record<
							string,
							{ autoApprove?: boolean; enabled?: boolean }
						>)
					: runtimeOptions.autoApproveTools === true
						? { "*": { autoApprove: true } }
						: undefined,
		});
		this.ensureSessionState(started.sessionId, clientId, "creator", {
			interactive: metadata.interactive !== false,
		});
		const session = await this.readHubSessionRecord(started.sessionId);
		if (session) {
			this.publish(
				this.buildEvent("session.created", { session }, started.sessionId),
			);
		}
		return {
			version: envelope.version,
			requestId: envelope.requestId,
			ok: true,
			payload: { session },
		};
	}

	private async handleSessionAttach(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		const sessionId =
			typeof envelope.payload?.sessionId === "string"
				? envelope.payload.sessionId.trim()
				: envelope.sessionId?.trim() || "";
		if (!sessionId) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "invalid_session_attach",
					message: "session.attach requires a session id",
				},
			};
		}
		this.ensureSessionState(
			sessionId,
			envelope.clientId?.trim() || "hub-client",
			"participant",
		);
		const session = await this.readHubSessionRecord(sessionId);
		if (session) {
			this.publish(this.buildEvent("session.attached", { session }, sessionId));
		}
		return {
			version: envelope.version,
			requestId: envelope.requestId,
			ok: Boolean(session),
			...(session
				? { payload: { session } }
				: {
						error: {
							code: "session_not_found",
							message: `Unknown session: ${sessionId}`,
						},
					}),
		};
	}

	private async handleSessionDetach(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		const sessionId =
			typeof envelope.payload?.sessionId === "string"
				? envelope.payload.sessionId.trim()
				: envelope.sessionId?.trim() || "";
		if (!sessionId) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "invalid_session_detach",
					message: "session.detach requires a session id",
				},
			};
		}
		const clientId = envelope.clientId?.trim() || "hub-client";
		const state = this.sessionState.get(sessionId);
		if (state) {
			state.participants.delete(clientId);
			if (state.participants.size === 0) {
				this.sessionState.delete(sessionId);
			}
		}
		const session = await this.readHubSessionRecord(sessionId);
		this.publish(
			this.buildEvent(
				"session.detached",
				session ? { session, clientId } : { clientId },
				sessionId,
			),
		);
		return {
			version: envelope.version,
			requestId: envelope.requestId,
			ok: true,
		};
	}

	private async handleSessionGet(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		const sessionId =
			typeof envelope.payload?.sessionId === "string"
				? envelope.payload.sessionId.trim()
				: envelope.sessionId?.trim() || "";
		const session = await this.readHubSessionRecord(sessionId);
		return {
			version: envelope.version,
			requestId: envelope.requestId,
			ok: Boolean(session),
			...(session
				? { payload: { session } }
				: {
						error: {
							code: "session_not_found",
							message: `Unknown session: ${sessionId}`,
						},
					}),
		};
	}

	private async handleSessionMessages(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		const sessionId =
			typeof envelope.payload?.sessionId === "string"
				? envelope.payload.sessionId.trim()
				: envelope.sessionId?.trim() || "";
		if (!sessionId) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "invalid_session_id",
					message: "session.messages requires a session id",
				},
			};
		}
		const session = await this.readHubSessionRecord(sessionId);
		if (!session) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "session_not_found",
					message: `Unknown session: ${sessionId}`,
				},
			};
		}
		const messages = await this.sessionHost.readMessages(sessionId);
		return {
			version: envelope.version,
			requestId: envelope.requestId,
			ok: true,
			payload: { sessionId, messages },
		};
	}

	private async handleSessionList(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		const limit =
			typeof envelope.payload?.limit === "number"
				? envelope.payload.limit
				: 200;
		const sessions = (await this.sessionHost.list(limit)).map((session) =>
			toHubSessionRecord(session, this.sessionState.get(session.sessionId)),
		);
		return {
			version: envelope.version,
			requestId: envelope.requestId,
			ok: true,
			payload: { sessions },
		};
	}

	private async handleSessionUpdate(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		const sessionId =
			typeof envelope.payload?.sessionId === "string"
				? envelope.payload.sessionId.trim()
				: envelope.sessionId?.trim() || "";
		const metadata =
			envelope.payload?.metadata &&
			typeof envelope.payload.metadata === "object" &&
			!Array.isArray(envelope.payload.metadata)
				? (envelope.payload.metadata as Record<string, JsonValue | undefined>)
				: undefined;
		const updated = await this.sessionHost.update(sessionId, { metadata });
		const session = await this.readHubSessionRecord(sessionId);
		if (session) {
			this.publish(this.buildEvent("session.updated", { session }, sessionId));
		}
		return {
			version: envelope.version,
			requestId: envelope.requestId,
			ok: updated.updated,
			payload: { updated: updated.updated, session },
		};
	}

	private async handleSessionPendingPrompts(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		const sessionId =
			typeof envelope.payload?.sessionId === "string"
				? envelope.payload.sessionId.trim()
				: envelope.sessionId?.trim() || "";
		const prompts = await this.sessionHost.pendingPrompts("list", {
			sessionId,
		});
		return {
			version: envelope.version,
			requestId: envelope.requestId,
			ok: true,
			payload: { sessionId, prompts },
		};
	}

	private async handleSessionUpdatePendingPrompt(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		const sessionId =
			typeof envelope.payload?.sessionId === "string"
				? envelope.payload.sessionId.trim()
				: envelope.sessionId?.trim() || "";
		const promptId =
			typeof envelope.payload?.promptId === "string"
				? envelope.payload.promptId.trim()
				: "";
		const prompt =
			typeof envelope.payload?.prompt === "string"
				? envelope.payload.prompt
				: undefined;
		const delivery =
			envelope.payload?.delivery === "queue" ||
			envelope.payload?.delivery === "steer"
				? envelope.payload.delivery
				: undefined;
		const result = await this.sessionHost.pendingPrompts("update", {
			sessionId,
			promptId,
			prompt,
			delivery,
		});
		return {
			version: envelope.version,
			requestId: envelope.requestId,
			ok: true,
			payload: result as unknown as Record<string, JsonValue | undefined>,
		};
	}

	private async handleSessionRemovePendingPrompt(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		const sessionId =
			typeof envelope.payload?.sessionId === "string"
				? envelope.payload.sessionId.trim()
				: envelope.sessionId?.trim() || "";
		const promptId =
			typeof envelope.payload?.promptId === "string"
				? envelope.payload.promptId.trim()
				: "";
		const result = await this.sessionHost.pendingPrompts("delete", {
			sessionId,
			promptId,
		});
		return {
			version: envelope.version,
			requestId: envelope.requestId,
			ok: true,
			payload: result as unknown as Record<string, JsonValue | undefined>,
		};
	}

	private async handleSessionDelete(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		const sessionId =
			typeof envelope.payload?.sessionId === "string"
				? envelope.payload.sessionId.trim()
				: envelope.sessionId?.trim() || "";
		const deleted = await this.sessionHost.delete(sessionId);
		this.sessionState.delete(sessionId);
		return {
			version: envelope.version,
			requestId: envelope.requestId,
			ok: true,
			payload: { deleted },
		};
	}

	private async handleSessionInput(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		const sessionId =
			typeof envelope.payload?.sessionId === "string"
				? envelope.payload.sessionId.trim()
				: envelope.sessionId?.trim() || "";
		const payload =
			envelope.payload && typeof envelope.payload === "object"
				? envelope.payload
				: {};
		const prompt =
			typeof payload.prompt === "string"
				? payload.prompt
				: typeof payload.input === "string"
					? payload.input
					: "";
		if (!prompt.trim()) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "invalid_session_input",
					message: "session input requires a prompt string",
				},
			};
		}
		this.publish(this.buildEvent("run.started", undefined, sessionId));
		const attachments =
			payload.attachments &&
			typeof payload.attachments === "object" &&
			!Array.isArray(payload.attachments)
				? (payload.attachments as Record<string, unknown>)
				: undefined;
		const result = await this.sessionHost.send({
			sessionId,
			prompt,
			delivery:
				payload.delivery === "queue" || payload.delivery === "steer"
					? payload.delivery
					: undefined,
			userImages: Array.isArray(attachments?.userImages)
				? (attachments.userImages as string[])
				: undefined,
		});
		if (result) {
			this.suppressNextTerminalEventBySession.set(
				sessionId,
				result.finishReason,
			);
			this.publish(
				this.buildEvent(
					"run.completed",
					{ reason: result.finishReason, result },
					sessionId,
				),
			);
		}
		return {
			version: envelope.version,
			requestId: envelope.requestId,
			ok: true,
			payload: result ? { result } : undefined,
		};
	}

	private async handleRunAbort(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		const sessionId =
			typeof envelope.payload?.sessionId === "string"
				? envelope.payload.sessionId.trim()
				: envelope.sessionId?.trim() || "";
		await this.sessionHost.abort(sessionId, envelope.payload?.reason);
		this.publish(
			this.buildEvent(
				"run.aborted",
				typeof envelope.payload?.reason === "string"
					? { reason: envelope.payload.reason }
					: undefined,
				sessionId,
			),
		);
		return {
			version: envelope.version,
			requestId: envelope.requestId,
			ok: true,
			payload: { applied: true },
		};
	}

	private async handleSessionHook(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		const parsed = parseHookEventPayload(envelope.payload?.payload);
		if (!parsed) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "invalid_hook_payload",
					message: "session.hook requires a valid hook event payload",
				},
			};
		}
		await this.sessionHost.handleHookEvent(parsed);
		return {
			version: envelope.version,
			requestId: envelope.requestId,
			ok: true,
			payload: { applied: true },
		};
	}

	private async requestToolApproval(
		request: ToolApprovalRequest,
	): Promise<{ approved: boolean; reason?: string }> {
		const approvalId = createSessionId("approval_");
		const sessionId = request.sessionId;
		const state = this.sessionState.get(sessionId);
		if (state?.interactive === false) {
			return {
				approved: false,
				reason:
					"Tool approval requires an interactive session, but this session is non-interactive.",
			};
		}
		return await new Promise((resolve) => {
			this.pendingApprovals.set(approvalId, {
				sessionId,
				resolve,
			});
			this.publish(
				this.buildEvent(
					"approval.requested",
					{
						approvalId,
						sessionId: request.sessionId,
						agentId: request.agentId,
						conversationId: request.conversationId,
						iteration: request.iteration,
						toolCallId: request.toolCallId,
						toolName: request.toolName,
						inputJson: JSON.stringify(request.input ?? null),
						policy: request.policy,
					},
					sessionId,
				),
			);
		});
	}

	private resolvePendingApproval(
		approvalId: string,
		result: { approved: boolean; reason?: string },
	): { sessionId: string } | undefined {
		const pending = this.pendingApprovals.get(approvalId);
		if (!pending) {
			return undefined;
		}
		this.pendingApprovals.delete(approvalId);
		pending.resolve(result);
		return { sessionId: pending.sessionId };
	}

	private async handleApprovalRespond(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		const approvalId =
			typeof envelope.payload?.approvalId === "string"
				? envelope.payload.approvalId.trim()
				: "";
		const pending = this.pendingApprovals.get(approvalId);
		if (!pending) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "approval_not_found",
					message: `Unknown approval: ${approvalId}`,
				},
			};
		}
		const reason =
			typeof envelope.payload?.reason === "string"
				? envelope.payload.reason
				: envelope.payload?.payload &&
						typeof envelope.payload.payload === "object" &&
						!Array.isArray(envelope.payload.payload) &&
						typeof (envelope.payload.payload as Record<string, unknown>)
							.reason === "string"
					? ((envelope.payload.payload as Record<string, unknown>)
							.reason as string)
					: undefined;
		const resolved = this.resolvePendingApproval(approvalId, {
			approved: envelope.payload?.approved === true,
			reason,
		});
		if (!resolved) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "approval_not_found",
					message: `Unknown approval: ${approvalId}`,
				},
			};
		}
		this.publish(
			this.buildEvent(
				"approval.resolved",
				{ approvalId, approved: envelope.payload?.approved === true, reason },
				resolved.sessionId,
			),
		);
		return {
			version: envelope.version,
			requestId: envelope.requestId,
			ok: true,
			payload: { approvalId, approved: envelope.payload?.approved === true },
		};
	}

	private async handleCapabilityRequest(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		const sessionId =
			typeof envelope.payload?.sessionId === "string"
				? envelope.payload.sessionId.trim()
				: envelope.sessionId?.trim() || "";
		const capabilityName =
			typeof envelope.payload?.capabilityName === "string"
				? envelope.payload.capabilityName.trim()
				: "";
		const targetClientId =
			typeof envelope.payload?.targetClientId === "string"
				? envelope.payload.targetClientId.trim()
				: "";
		if (!sessionId || !capabilityName || !targetClientId) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "invalid_capability_request",
					message:
						"capability.request requires sessionId, capabilityName, and targetClientId",
				},
			};
		}
		try {
			const payload =
				envelope.payload?.payload &&
				typeof envelope.payload.payload === "object" &&
				!Array.isArray(envelope.payload.payload)
					? (envelope.payload.payload as Record<string, unknown>)
					: {};
			const response = await this.requestCapability(
				sessionId,
				capabilityName,
				payload,
				targetClientId,
			);
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: true,
				payload: response,
			};
		} catch (error) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "capability_request_failed",
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	private async handleCapabilityRespond(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		const requestId =
			typeof envelope.payload?.requestId === "string"
				? envelope.payload.requestId.trim()
				: "";
		const pending = this.pendingCapabilityRequests.get(requestId);
		if (!pending) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "capability_not_found",
					message: `Unknown capability request: ${requestId}`,
				},
			};
		}
		this.pendingCapabilityRequests.delete(requestId);
		const payload =
			envelope.payload?.payload &&
			typeof envelope.payload.payload === "object" &&
			!Array.isArray(envelope.payload.payload)
				? (envelope.payload.payload as Record<string, unknown>)
				: undefined;
		const error =
			typeof envelope.payload?.error === "string"
				? envelope.payload.error
				: undefined;
		const ok = envelope.payload?.ok === true;
		pending.resolve({ ok, payload, error });
		this.publish(
			this.buildEvent(
				"capability.resolved",
				{
					requestId,
					capabilityName: pending.capabilityName,
					targetClientId: envelope.clientId?.trim(),
					ok,
					payload,
					error,
				},
				pending.sessionId,
			),
		);
		return {
			version: envelope.version,
			requestId: envelope.requestId,
			ok: true,
			payload: { requestId, ok },
		};
	}

	private async handleSessionEvent(event: CoreSessionEvent): Promise<void> {
		switch (event.type) {
			case "chunk":
				// Ignore raw agent chunks here. In this runtime they can contain
				// serialized event envelopes rather than user-facing assistant text.
				// Structured live content is forwarded via the "agent_event" branch.
				return;
			case "agent_event": {
				const { sessionId, event: agentEvent } = event.payload;
				if (agentEvent.type === "content_start") {
					if (
						agentEvent.contentType === "text" &&
						typeof agentEvent.text === "string" &&
						agentEvent.text.length > 0
					) {
						this.publish(
							this.buildEvent(
								"assistant.delta",
								{ text: agentEvent.text },
								sessionId,
							),
						);
						return;
					}
					if (agentEvent.contentType === "reasoning") {
						if (agentEvent.redacted && !agentEvent.reasoning) {
							this.publish(
								this.buildEvent(
									"reasoning.delta",
									{ text: "", redacted: true },
									sessionId,
								),
							);
							return;
						}
						if (
							typeof agentEvent.reasoning === "string" &&
							agentEvent.reasoning.length > 0
						) {
							this.publish(
								this.buildEvent(
									"reasoning.delta",
									{
										text: agentEvent.reasoning,
										redacted: agentEvent.redacted === true,
									},
									sessionId,
								),
							);
						}
						return;
					}
					if (agentEvent.contentType === "tool") {
						this.publish(
							this.buildEvent(
								"tool.started",
								{
									toolCallId: agentEvent.toolCallId,
									toolName: agentEvent.toolName,
									input: agentEvent.input,
								},
								sessionId,
							),
						);
						return;
					}
				}
				if (
					agentEvent.type === "content_end" &&
					agentEvent.contentType === "tool"
				) {
					this.publish(
						this.buildEvent(
							"tool.finished",
							{
								toolCallId: agentEvent.toolCallId,
								toolName: agentEvent.toolName,
								output: agentEvent.output,
								error: agentEvent.error,
							},
							sessionId,
						),
					);
				}
				return;
			}
			case "hook":
				if (event.payload.hookEventName === "tool_call") {
					this.publish(
						this.buildEvent(
							"tool.started",
							{ toolName: event.payload.toolName },
							event.payload.sessionId,
						),
					);
				} else if (event.payload.hookEventName === "tool_result") {
					this.publish(
						this.buildEvent(
							"tool.finished",
							{ toolName: event.payload.toolName },
							event.payload.sessionId,
						),
					);
				}
				return;
			case "team_progress": {
				const projection: TeamProgressProjectionEvent = {
					type: "team_progress_projection",
					version: 1,
					sessionId: event.payload.sessionId,
					summary: event.payload.summary,
					lastEvent: event.payload.lifecycle,
				};
				this.publish(
					this.buildEvent(
						"team.progress",
						projection as unknown as Record<string, unknown>,
						event.payload.sessionId,
					),
				);
				return;
			}
			case "pending_prompts": {
				this.publish(
					this.buildEvent(
						"session.pending_prompts",
						{
							sessionId: event.payload.sessionId,
							prompts: event.payload.prompts,
						},
						event.payload.sessionId,
					),
				);
				return;
			}
			case "pending_prompt_submitted": {
				const prompt: SessionPendingPrompt = {
					id: event.payload.id,
					prompt: event.payload.prompt,
					delivery: event.payload.delivery,
					attachmentCount: event.payload.attachmentCount,
				};
				this.publish(
					this.buildEvent(
						"session.pending_prompt_submitted",
						{ sessionId: event.payload.sessionId, prompt },
						event.payload.sessionId,
					),
				);
				return;
			}
			case "status": {
				const session = await this.readHubSessionRecord(
					event.payload.sessionId,
				);
				if (session) {
					this.publish(
						this.buildEvent(
							"session.updated",
							{ session },
							event.payload.sessionId,
						),
					);
				}
				return;
			}
			case "ended": {
				const suppressDuplicateTerminalEvent =
					this.suppressNextTerminalEventBySession.get(
						event.payload.sessionId,
					) === event.payload.reason;
				if (suppressDuplicateTerminalEvent) {
					this.suppressNextTerminalEventBySession.delete(
						event.payload.sessionId,
					);
				}
				if (event.payload.reason === "completed") {
					const session = await this.readHubSessionRecord(
						event.payload.sessionId,
					);
					const notification = await buildCompletionNotification(session);
					this.publish(
						this.buildEvent("ui.notify", notification, event.payload.sessionId),
					);
				}
				if (suppressDuplicateTerminalEvent) {
					return;
				}
				this.publish(
					this.buildEvent(
						event.payload.reason === "aborted"
							? "run.aborted"
							: "run.completed",
						{ reason: event.payload.reason },
						event.payload.sessionId,
					),
				);
				return;
			}
			default:
				return;
		}
	}

	subscribe(
		clientId: string,
		listener: (event: HubEventEnvelope) => void,
		options?: { sessionId?: string },
	): () => void {
		const current = this.listeners.get(clientId) ?? new Set();
		const entry = { sessionId: options?.sessionId, listener };
		current.add(entry);
		this.listeners.set(clientId, current);
		return () => {
			const listeners = this.listeners.get(clientId);
			if (!listeners) {
				return;
			}
			listeners.delete(entry);
			if (listeners.size === 0) {
				this.listeners.delete(clientId);
			}
		};
	}

	private publish(event: HubEventEnvelope): void {
		for (const entries of this.listeners.values()) {
			for (const entry of entries) {
				if (entry.sessionId && entry.sessionId !== event.sessionId) {
					continue;
				}
				try {
					entry.listener(event);
				} catch (error) {
					logHubBoundaryError(
						`listener threw while publishing ${event.event}`,
						error,
					);
				}
			}
		}
	}
}

function logHubBoundaryError(message: string, error: unknown): void {
	const details =
		error instanceof Error ? error.stack || error.message : String(error);
	console.error(`[hub] ${message}: ${details}`);
}

export interface HubWebSocketServerOptions {
	host?: string;
	port?: number;
	pathname?: string;
	owner?: HubOwnerContext;
	sessionHost?: RuntimeHost;
	runtimeHandlers: HubScheduleRuntimeHandlers;
	scheduleOptions?: Omit<HubScheduleServiceOptions, "runtimeHandlers">;
	/**
	 * File-based cron automation options. When provided, the hub starts a
	 * `CronService` that watches global `~/.cline/cron/` by default, reconciles
	 * specs into `cron.db`, and executes queued runs through `runtimeHandlers`.
	 * Pass `cronOptions.specs` to use a different source, including future
	 * workspace-scoped specs.
	 */
	cronOptions?: Omit<CronServiceOptions, "runtimeHandlers">;
	/**
	 * Custom `fetch` implementation forwarded to the internally-constructed
	 * `LocalRuntimeHost` that executes incoming `session.create` traffic.
	 * Used by the AI gateway providers for every session that runs inside
	 * this hub process.
	 *
	 * Ignored when `sessionHost` is supplied — in that case the caller owns
	 * runtime construction and is responsible for wiring its own fetch.
	 */
	fetch?: typeof fetch;
}

export interface HubWebSocketServer {
	host: string;
	port: number;
	url: string;
	close(): Promise<void>;
}

export interface EnsureHubWebSocketServerOptions
	extends HubWebSocketServerOptions {
	allowPortFallback?: boolean;
}

export interface EnsuredHubWebSocketServerResult {
	server?: HubWebSocketServer;
	url: string;
	action: "reuse" | "started";
}

const SHARED_SERVERS = new Map<string, Promise<HubWebSocketServer>>();

export async function startHubWebSocketServer(
	options: HubWebSocketServerOptions,
): Promise<HubWebSocketServer> {
	const owner = options.owner ?? resolveHubOwnerContext();
	const host = options.host ?? "127.0.0.1";
	const pathname = options.pathname ?? "/hub";
	const requestedPort = options.port ?? resolveDefaultHubPort();
	let port = requestedPort;
	let url = createHubServerUrl(host, requestedPort, pathname);
	const buildId = resolveHubBuildId();
	const transport = new HubServerTransport(options);
	await transport.start();
	const adapter = new BrowserWebSocketHubAdapter(
		new NativeHubTransportAdapter(transport),
	);
	const cleanup = new Set<() => void>();
	const startedAt = new Date().toISOString();
	const versionPayload = {
		protocolVersion: "v1",
		buildId,
		pid: process.pid,
		startedAt,
	} as const;
	let closePromise: Promise<void> | undefined;

	const closeServer = async (): Promise<void> => {
		if (closePromise) {
			return closePromise;
		}
		closePromise = (async () => {
			for (const detach of cleanup) {
				detach();
			}
			cleanup.clear();
			await new Promise<void>((resolve, reject) => {
				wss.close((error?: Error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
			await new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
			await transport.stop();
			const current = await readHubDiscovery(owner.discoveryPath);
			if (current?.url === url) {
				await clearHubDiscovery(owner.discoveryPath);
			}
		})();
		return closePromise;
	};

	const server = http.createServer((req, res) => {
		if ((req.url ?? "/") === "/health") {
			const body = JSON.stringify({
				hubId: transport.getHubId(),
				...versionPayload,
				host,
				port,
				url,
				updatedAt: new Date().toISOString(),
			} satisfies HubServerDiscoveryRecord);
			res.statusCode = 200;
			res.setHeader("content-type", "application/json");
			res.end(body);
			return;
		}
		if ((req.url ?? "/") === "/version") {
			res.statusCode = 200;
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify(versionPayload));
			return;
		}
		if ((req.url ?? "/") === "/shutdown" && req.method === "POST") {
			res.statusCode = 202;
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ ok: true }));
			queueMicrotask(() => {
				void closeServer();
			});
			return;
		}
		res.statusCode = 404;
		res.end("Not found");
	});
	const wss = new WebSocketServer({ noServer: true });

	server.on("upgrade", (request, socket, head) => {
		const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
		if (requestUrl.pathname !== pathname) {
			socket.destroy();
			return;
		}
		try {
			wss.handleUpgrade(
				request,
				socket,
				head,
				(websocket: NodeWebSocketLike) => {
					const detach = adapter.attach(wrapWsSocket(websocket));
					cleanup.add(detach);
					websocket.once("close", () => {
						detach();
						cleanup.delete(detach);
					});
				},
			);
		} catch {
			rejectUpgradeSocket(socket);
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", (error) => {
			reject(
				formatHubStartupError(error, {
					host,
					port: requestedPort,
					pathname,
				}),
			);
		});
		server.listen(requestedPort, host, () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				reject(
					formatHubStartupError(new Error("Failed to resolve hub port"), {
						host,
						port: requestedPort,
						pathname,
					}),
				);
				return;
			}
			port = address.port;
			url = createHubServerUrl(host, port, pathname);
			resolve();
		});
	});

	await writeHubDiscovery(owner.discoveryPath, {
		hubId: transport.getHubId(),
		protocolVersion: "v1",
		buildId,
		host,
		port,
		url,
		pid: process.pid,
		startedAt,
		updatedAt: startedAt,
	});

	return {
		host,
		port,
		url,
		close: closeServer,
	};
}

export async function ensureHubWebSocketServer(
	options: EnsureHubWebSocketServerOptions,
): Promise<EnsuredHubWebSocketServerResult> {
	const owner = options.owner ?? resolveHubOwnerContext();
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? resolveDefaultHubPort();
	const pathname = options.pathname ?? "/hub";
	const expectedUrl = createHubServerUrl(host, port, pathname);
	const sharedKey = owner.discoveryPath;
	const existing = SHARED_SERVERS.get(sharedKey);
	if (existing) {
		const server = await existing;
		if (server.url === expectedUrl) {
			return { server, url: server.url, action: "reuse" };
		}
	}

	return await withHubStartupLock(owner.discoveryPath, async () => {
		const discovered = await readHubDiscovery(owner.discoveryPath);
		const canReuseDiscovered =
			discovered?.url &&
			(discovered.url === expectedUrl || options.allowPortFallback === true);
		if (canReuseDiscovered) {
			const healthy = await probeHubServer(discovered.url);
			if (healthy?.url && (await verifyHubConnection(healthy.url))) {
				return { url: healthy.url, action: "reuse" };
			}
		}

		const expected = await probeHubServer(expectedUrl);
		if (expected?.url && (await verifyHubConnection(expected.url))) {
			await writeHubDiscovery(owner.discoveryPath, expected);
			return { url: expected.url, action: "reuse" };
		}

		if (discovered?.url) {
			await clearHubDiscovery(owner.discoveryPath);
		}

		const start = async (
			startOptions: HubWebSocketServerOptions,
		): Promise<EnsuredHubWebSocketServerResult> => {
			const serverPromise = startHubWebSocketServer({ ...startOptions, owner });
			SHARED_SERVERS.set(sharedKey, serverPromise);
			try {
				const server = await serverPromise;
				return { server, url: server.url, action: "started" };
			} catch (error) {
				SHARED_SERVERS.delete(sharedKey);
				throw error;
			}
		};

		try {
			return await start(options);
		} catch (error) {
			if (!options.allowPortFallback || !isAddressInUseError(error)) {
				throw error;
			}
			return await start({ ...options, port: 0 });
		}
	});
}
