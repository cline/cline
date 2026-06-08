import { createHmac, timingSafeEqual } from "node:crypto";
import {
	type AgentPhoneRawMessage,
	createAgentPhoneAdapter,
} from "@agentphone/chat-sdk-adapter";
import type { ChatStartSessionRequest } from "@cline/core";
import {
	createUserInstructionConfigService,
	HubSessionClient,
} from "@cline/core";
import type {
	AgentPhoneConnectorState,
	ConnectAgentPhoneOptions,
} from "@cline/shared";
import { type Adapter, Chat, ConsoleLogger, type Thread } from "chat";
import type { Command } from "commander";
import type { CliLoggerAdapter } from "../../logging/adapter";
import { createCliLoggerAdapter } from "../../logging/adapter";
import {
	ensureCliHubServer,
	parseHubEndpointOverride,
	resolveDefaultCliRpcAddress,
} from "../../utils/hub-runtime";
import { createWorkspaceChatCommandHost } from "../../utils/plugin-chat-commands";
import { ConnectorBase } from "../base";
import {
	createChatSdkLogger,
	enqueueThreadTurn,
	startConnectorWebhookServer,
} from "../chat-runtime";
import { isProcessRunning } from "../common";
import {
	type ActiveConnectorTurn,
	handleConnectorUserTurn,
	maybeHandleConnectorApprovalReply,
} from "../connector-host";
import { dispatchConnectorHook } from "../hooks";
import {
	type PendingConnectorApproval,
	truncateConnectorText,
} from "../runtime-turn";
import {
	buildConnectorStartRequest,
	readSessionReplyText,
	stopConnectorSessions,
} from "../session-runtime";
import { InMemoryStateAdapter } from "../stores/memory-state";
import { startConnectorTaskUpdateRelay } from "../task-updates";
import {
	type ConnectorBindingStore,
	type ConnectorThreadState,
	clearBindingSessionIds,
	findBindingForParticipantKey,
	findBindingForThread,
	loadThreadState,
	persistMergedThreadState,
	readBindings,
} from "../thread-bindings";
import type {
	ConnectCommandDefinition,
	ConnectIo,
	ConnectStopResult,
} from "../types";
import {
	getConnectorFirstContactMessage,
	getConnectorSystemPrompt,
	getConnectorSystemRules,
} from "./prompts";

const AGENTPHONE_SYSTEM_RULES = getConnectorSystemRules(
	"AgentPhone",
	"You can respond to SMS, MMS, iMessage, and voice call transcript threads. Keep replies suitable for phone messaging unless the user asks for detail.",
);

const AGENTPHONE_FIRST_CONTACT_MESSAGE = getConnectorFirstContactMessage();

type AgentPhoneThreadState = ConnectorThreadState;

type AgentPhoneVoiceTurnPayload = {
	threadId: string;
	text: string;
	rawMessage: AgentPhoneRawMessage;
};

type AgentPhoneMessageTurnPayload = AgentPhoneVoiceTurnPayload;

type AgentPhoneNumber = {
	id: string;
	phoneNumber: string;
	country?: string;
	status?: string;
	type?: string;
	agentId?: string;
	createdAt?: string;
};

const DEFAULT_AGENTPHONE_API_URL = "https://api.agentphone.ai";

function truncateText(value: string, maxLength = 160): string {
	return truncateConnectorText(value, maxLength);
}

function resolveInstanceKey(input: {
	agentId: string;
	userName?: string;
}): string {
	return (input.agentId.trim() || input.userName || "agentphone").replace(
		/[^a-zA-Z0-9._-]+/g,
		"_",
	);
}

async function stopSessionsForConnector(
	state: AgentPhoneConnectorState,
): Promise<number> {
	return stopConnectorSessions({
		rpcAddress: state.rpcAddress,
		rpcMatcher: (metadata) =>
			metadata?.transport === "agentphone" &&
			metadata?.agentId === state.agentId,
		localMatcher: (metadata) =>
			metadata?.transport === "agentphone" &&
			metadata?.agentId === state.agentId,
	});
}

async function buildAgentPhoneStartRequest(
	options: ConnectAgentPhoneOptions,
	io: ConnectIo,
	loggerConfig: Parameters<
		typeof buildConnectorStartRequest
	>[0]["loggerConfig"],
): Promise<ChatStartSessionRequest> {
	return buildConnectorStartRequest({
		options: {
			...options,
			apiKey: options.apiProviderKey,
		},
		io,
		loggerConfig,
		systemRules: AGENTPHONE_SYSTEM_RULES,
	});
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: undefined;
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveAgentPhoneApiUrl(apiUrl: string | undefined): string {
	return (apiUrl?.trim() || DEFAULT_AGENTPHONE_API_URL).replace(/\/$/, "");
}

function parseAgentPhoneNumber(value: unknown): AgentPhoneNumber | undefined {
	const record = asRecord(value);
	const id = readString(record?.id);
	const phoneNumber = readString(record?.phoneNumber);
	if (!id || !phoneNumber) {
		return undefined;
	}
	return {
		id,
		phoneNumber,
		country: readString(record?.country),
		status: readString(record?.status),
		type: readString(record?.type),
		agentId: readString(record?.agentId),
		createdAt: readString(record?.createdAt),
	};
}

function selectAgentPhoneNumber(input: {
	numbers: AgentPhoneNumber[];
	agentId: string;
}): AgentPhoneNumber | undefined {
	const matching = input.numbers.filter(
		(number) => number.agentId === input.agentId,
	);
	return (
		matching.find((number) => number.status?.toLowerCase() === "active") ||
		matching[0]
	);
}

async function fetchAgentPhoneNumber(input: {
	apiKey: string;
	agentId: string;
	apiUrl?: string;
	fetchImpl?: typeof fetch;
}): Promise<AgentPhoneNumber> {
	const apiUrl = resolveAgentPhoneApiUrl(input.apiUrl);
	const fetchImpl = input.fetchImpl ?? fetch;
	const response = await fetchImpl(`${apiUrl}/v1/numbers`, {
		headers: {
			Authorization: `Bearer ${input.apiKey}`,
			Accept: "application/json",
		},
	});
	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(
			`AgentPhone API verification failed (${response.status} ${response.statusText}): ${body || "unable to list numbers"}`,
		);
	}
	const parsed = (await response.json().catch(() => undefined)) as unknown;
	const data = asRecord(parsed)?.data;
	const numbers = Array.isArray(data)
		? data
				.map((entry) => parseAgentPhoneNumber(entry))
				.filter((number): number is AgentPhoneNumber => Boolean(number))
		: [];
	const selected = selectAgentPhoneNumber({
		numbers,
		agentId: input.agentId,
	});
	if (!selected) {
		throw new Error(
			`AgentPhone API verification failed: no phone number is assigned to agent ${input.agentId}.`,
		);
	}
	if (selected.status?.toLowerCase() !== "active") {
		throw new Error(
			`AgentPhone API verification failed: phone number ${selected.phoneNumber} for agent ${input.agentId} is ${selected.status || "not active"}.`,
		);
	}
	return selected;
}

function parseJsonRecord(rawBody: string): Record<string, unknown> | undefined {
	if (!rawBody.trim()) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(rawBody) as unknown;
		return asRecord(parsed);
	} catch {
		return undefined;
	}
}

function verifyAgentPhoneWebhookSignature(input: {
	rawBody: string;
	secret: string | undefined;
	signature: string | null;
}): boolean {
	const secret = input.secret?.trim();
	if (!secret) {
		return false;
	}
	const signature = input.signature?.trim();
	const actualHex = signature?.startsWith("sha256=")
		? signature.slice("sha256=".length)
		: signature;
	if (!actualHex || !/^[a-f0-9]+$/i.test(actualHex)) {
		return false;
	}
	const expectedHex = createHmac("sha256", secret)
		.update(input.rawBody)
		.digest("hex");
	const actual = Buffer.from(actualHex, "hex");
	const expected = Buffer.from(expectedHex, "hex");
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isVoiceWebhookPayload(
	payload: Record<string, unknown> | undefined,
): boolean {
	return (
		readString(payload?.channel) === "voice" ||
		readString(payload?.event)?.startsWith("agent.call") === true
	);
}

function isMessageWebhookPayload(
	payload: Record<string, unknown> | undefined,
): boolean {
	const channel = readString(payload?.channel);
	return (
		readString(payload?.event) === "agent.message" &&
		(channel === "sms" || channel === "mms" || channel === "imessage")
	);
}

function isAgentPhoneVoiceMessagePayload(
	payload: Record<string, unknown> | undefined,
): boolean {
	return (
		isVoiceWebhookPayload(payload) &&
		readString(payload?.event) === "agent.message"
	);
}

function resolveAgentPhoneMessageTurnPayload(
	payload: Record<string, unknown> | undefined,
): AgentPhoneMessageTurnPayload | undefined {
	if (!isMessageWebhookPayload(payload)) {
		return undefined;
	}
	const data = asRecord(payload?.data);
	if (readString(data?.direction) !== "inbound") {
		return undefined;
	}
	const message = readString(data?.message);
	const from = readString(data?.from);
	const to = readString(data?.to);
	if (!message || !from || !to) {
		return undefined;
	}
	return {
		threadId: `agentphone:${to}:${from}`,
		text: message,
		rawMessage: {
			messageId:
				readString(data?.messageId) ||
				readString(data?.conversationId) ||
				readString(payload?.timestamp) ||
				`message-${Date.now()}`,
			conversationId: readString(data?.conversationId) || null,
			numberId: readString(data?.numberId) || null,
			from,
			to,
			contact:
				(asRecord(
					data?.contact,
				) as unknown as AgentPhoneRawMessage["contact"]) ?? null,
			message,
			mediaUrl: readString(data?.mediaUrl) || null,
			mediaUrls: Array.isArray(data?.mediaUrls)
				? data.mediaUrls.filter(
						(mediaUrl): mediaUrl is string => typeof mediaUrl === "string",
					)
				: [],
			direction: "inbound",
			receivedAt:
				readString(data?.receivedAt) ||
				readString(payload?.timestamp) ||
				new Date().toISOString(),
		},
	};
}

function resolveAgentPhoneVoiceTurnPayload(
	payload: Record<string, unknown> | undefined,
): AgentPhoneVoiceTurnPayload | undefined {
	if (!isAgentPhoneVoiceMessagePayload(payload)) {
		return undefined;
	}
	const data = asRecord(payload?.data);
	const message = readString(data?.message);
	const from = readString(data?.from);
	const to = readString(data?.to);
	if (!message || !from || !to) {
		return undefined;
	}
	const direction = readString(data?.direction);
	const isOutbound = direction === "outbound";
	return {
		threadId: `agentphone:${isOutbound ? from : to}:${isOutbound ? to : from}`,
		text: message,
		rawMessage: {
			messageId:
				readString(data?.messageId) ||
				readString(data?.conversationId) ||
				readString(payload?.timestamp) ||
				`voice-${Date.now()}`,
			conversationId: readString(data?.conversationId) || null,
			numberId: readString(data?.numberId) || null,
			from,
			to,
			contact:
				(asRecord(
					data?.contact,
				) as unknown as AgentPhoneRawMessage["contact"]) ?? null,
			message,
			mediaUrl: null,
			mediaUrls: [],
			direction: isOutbound ? "outbound" : "inbound",
			receivedAt:
				readString(data?.receivedAt) ||
				readString(payload?.timestamp) ||
				new Date().toISOString(),
		},
	};
}

async function normalizeAgentPhoneWebhookResponse(input: {
	response: Response;
	payload: Record<string, unknown> | undefined;
}): Promise<Response> {
	const contentType = input.response.headers.get("content-type") ?? "";
	if (contentType.toLowerCase().includes("application/json")) {
		return input.response;
	}
	const bodyText = await input.response.text().catch(() => "");
	if (!input.response.ok) {
		return Response.json(
			{ error: bodyText || input.response.statusText || "Webhook failed" },
			{ status: input.response.status },
		);
	}
	if (isVoiceWebhookPayload(input.payload)) {
		return Response.json({
			text: "Cline is connected. I will process the call transcript when this call ends.",
		});
	}
	return Response.json({ ok: true });
}

function formatAgentPhoneRequestError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const normalized = message.replace(/^Auth failed:\s*/i, "").trim();
	return `Request failed. ${normalized || "AgentPhone connector failed."}`;
}

function formatAgentPhoneVoiceText(text: string | undefined): string {
	const normalized = text?.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return "I do not have an answer yet.";
	}
	return normalized.length > 1200
		? `${normalized.slice(0, 1197).trimEnd()}...`
		: normalized;
}

function encodeAgentPhoneVoiceChunk(input: {
	text: string;
	interim?: boolean;
	hangup?: boolean;
}): Uint8Array {
	return new TextEncoder().encode(`${JSON.stringify(input)}\n`);
}

function agentPhoneVoiceResponse(
	resolveFinalText: () => Promise<string | undefined>,
): Response {
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			controller.enqueue(
				encodeAgentPhoneVoiceChunk({
					text: "One moment, let me check.",
					interim: true,
				}),
			);
			try {
				const finalText = await resolveFinalText();
				controller.enqueue(
					encodeAgentPhoneVoiceChunk({
						text: formatAgentPhoneVoiceText(finalText),
					}),
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				controller.enqueue(
					encodeAgentPhoneVoiceChunk({
						text: formatAgentPhoneVoiceText(
							`I ran into an error handling that: ${message}`,
						),
					}),
				);
			} finally {
				controller.close();
			}
		},
	});
	return new Response(stream, {
		headers: {
			"content-type": "application/x-ndjson; charset=utf-8",
		},
	});
}

async function postAgentPhoneReply(input: {
	thread: Thread<AgentPhoneThreadState>;
	text: string;
	logger: CliLoggerAdapter;
	io: ConnectIo;
}): Promise<void> {
	const text = input.text.trim();
	const metadata = {
		transport: "agentphone",
		threadId: input.thread.id,
		channelId: input.thread.channelId,
		outputLength: text.length,
		outputPreview: truncateText(text),
	};
	input.logger.core.log("AgentPhone outbound reply sending", metadata);
	input.io.writeln(
		`[agentphone] sending reply thread=${input.thread.id} chars=${text.length}`,
	);
	try {
		await input.thread.post(text);
		input.logger.core.log("AgentPhone outbound reply sent", metadata);
		input.io.writeln(
			`[agentphone] sent reply thread=${input.thread.id} chars=${text.length}`,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		input.logger.core.error?.("AgentPhone outbound reply failed", {
			...metadata,
			error,
		});
		input.io.writeln(
			`[agentphone] failed to send reply thread=${input.thread.id} error=${message}`,
		);
		throw error;
	}
}

function isAgentPhoneDebugEnabled(): boolean {
	const value = process.env.CLINE_AGENTPHONE_DEBUG?.trim().toLowerCase();
	return value === "1" || value === "true";
}

function formatAgentPhoneDebugLine(input: {
	phase: "received" | "responded" | "background_error";
	event?: string;
	channel?: string;
	status?: number;
	contentType?: string;
	error?: string;
}): string {
	const parts = [
		`phase=${input.phase}`,
		input.event ? `event=${input.event}` : undefined,
		input.channel ? `channel=${input.channel}` : undefined,
		input.status ? `status=${input.status}` : undefined,
		input.contentType ? `contentType=${input.contentType}` : undefined,
		input.error ? `error=${input.error}` : undefined,
	].filter((part): part is string => Boolean(part));
	return `[agentphone] webhook ${parts.join(" ")}`;
}

function normalizeParticipantAddress(value: string): string {
	const trimmed = value.trim();
	return trimmed.includes("@") ? trimmed.toLowerCase() : trimmed;
}

function resolveAgentPhoneParticipant(
	rawMessage: unknown,
): { key: string; label?: string } | undefined {
	const raw = asRecord(rawMessage);
	const contact = asRecord(raw?.contact);
	const direction = readString(raw?.direction);
	const from = readString(raw?.from);
	const to = readString(raw?.to);
	const participantAddress =
		readString(contact?.phoneNumber) ||
		readString(contact?.email) ||
		(direction === "outbound" ? to : from) ||
		from ||
		to;
	if (!participantAddress) {
		return undefined;
	}
	const normalizedAddress = normalizeParticipantAddress(participantAddress);
	return {
		key: `agentphone:user:${normalizedAddress}`,
		label:
			readString(contact?.name) ||
			readString(contact?.email) ||
			readString(contact?.phoneNumber) ||
			normalizedAddress,
	};
}

async function persistAgentPhoneThreadContext(input: {
	thread: Thread<AgentPhoneThreadState>;
	bindingsPath: string;
	baseStartRequest: ChatStartSessionRequest;
	rawMessage: unknown;
	errorLabel: string;
}): Promise<void> {
	const participant = resolveAgentPhoneParticipant(input.rawMessage);
	if (!participant) {
		return;
	}
	const currentState = await loadThreadState(
		input.thread,
		input.bindingsPath,
		input.baseStartRequest,
	);
	if (
		currentState.participantKey === participant.key &&
		currentState.participantLabel === participant.label
	) {
		return;
	}
	await persistMergedThreadState(
		input.thread,
		input.bindingsPath,
		{
			...currentState,
			participantKey: participant.key,
			participantLabel: participant.label,
		},
		input.errorLabel,
	);
}

async function deliverScheduledResult(input: {
	bot: Chat;
	client: HubSessionClient;
	logger: CliLoggerAdapter;
	bindingsPath: string;
	options: ConnectAgentPhoneOptions;
	scheduleId: string;
	executionId: string;
	sessionId?: string;
	status: string;
	errorMessage?: string;
	hookCommand?: string;
}): Promise<void> {
	const schedule = await input.client.getSchedule(input.scheduleId);
	const delivery = schedule?.metadata?.delivery as
		| Record<string, unknown>
		| undefined;
	if (!delivery || delivery.adapter !== "agentphone") {
		return;
	}
	const targetAgentId =
		typeof delivery.agentId === "string" ? delivery.agentId.trim() : "";
	if (targetAgentId && targetAgentId !== input.options.agentId) {
		return;
	}
	const targetUserName =
		typeof delivery.userName === "string" ? delivery.userName.trim() : "";
	if (targetUserName && targetUserName !== input.options.userName) {
		return;
	}
	const threadId =
		typeof delivery.threadId === "string" ? delivery.threadId.trim() : "";
	const bindingKey =
		typeof delivery.bindingKey === "string"
			? delivery.bindingKey.trim()
			: typeof delivery.participantKey === "string"
				? delivery.participantKey.trim()
				: "";
	if (!threadId && !bindingKey) {
		return;
	}
	const bindings = readBindings<AgentPhoneThreadState>(input.bindingsPath);
	const match = bindingKey
		? findBindingForParticipantKey(bindings, bindingKey)
		: threadId
			? { key: threadId, binding: bindings[threadId] }
			: undefined;
	const binding = match?.binding;
	if (!binding?.serializedThread) {
		return;
	}
	await dispatchConnectorHook(
		input.hookCommand,
		{
			adapter: "agentphone",
			botUserName: input.options.userName,
			event: "schedule.delivery.started",
			payload: {
				threadId: match?.key || threadId,
				scheduleId: input.scheduleId,
				executionId: input.executionId,
				sessionId: input.sessionId,
				status: input.status,
			},
			ts: new Date().toISOString(),
		},
		input.logger,
	);
	const thread = JSON.parse(
		binding.serializedThread,
		input.bot.reviver(),
	) as Thread<AgentPhoneThreadState>;
	let body = "";
	if (input.status === "success" && input.sessionId) {
		const text = await readSessionReplyText(input.client, input.sessionId);
		body = text?.trim()
			? text
			: `Schedule "${schedule?.name ?? input.scheduleId}" completed, but no assistant reply text was found.`;
	} else {
		body = `Schedule "${schedule?.name ?? input.scheduleId}" ${input.status}.${input.errorMessage ? `\n\n${input.errorMessage}` : ""}`;
	}
	await thread.post(body);
}

class AgentPhoneConnector extends ConnectorBase<
	ConnectAgentPhoneOptions,
	AgentPhoneConnectorState
> {
	constructor() {
		super(
			"agentphone",
			"AgentPhone SMS, MMS, iMessage, and voice webhook bridge backed by RPC runtime sessions",
		);
	}

	protected override createCommand(): Command {
		return super
			.createCommand()
			.usage("--base-url <PUBLIC_BASE_URL> [options]")
			.option("--user-name <name>", "AgentPhone bot display name")
			.option("--api-key <key>", "AgentPhone API key")
			.option("--agent-id <id>", "AgentPhone agent id")
			.option("--webhook-secret <secret>", "AgentPhone webhook signing secret")
			.option("--api-url <url>", "AgentPhone API base URL")
			.option("--provider <id>", "Provider override")
			.option("--model <id>", "Model override")
			.option("--provider-api-key <key>", "Provider API key override")
			.option("--system <prompt>", "System prompt override")
			.option("--cwd <path>", "Workspace / cwd for runtime")
			.option("--mode <act|plan>", "Agent mode", "act")
			.option("-i, --interactive", "Keep connector in foreground")
			.option("--enable-tools", "Enable tools for AgentPhone sessions")
			.option(
				"--hook-command <command>",
				"Run a shell command for connector events",
			)
			.option(
				"--rpc-address <host:port>",
				"RPC address",
				process.env.CLINE_RPC_ADDRESS?.trim() || resolveDefaultCliRpcAddress(),
			)
			.option("--host <host>", "Webhook listen host")
			.option("--port <port>", "Webhook listen port")
			.option("--base-url <url>", "Public base URL for webhook configuration")
			.addHelpText(
				"after",
				[
					"",
					"Environment:",
					"  AGENTPHONE_API_KEY          AgentPhone API key",
					"  AGENTPHONE_AGENT_ID         AgentPhone agent id",
					"  AGENTPHONE_WEBHOOK_SECRET   Webhook signing secret",
					"  AGENTPHONE_API_URL          API base URL override",
					"  AGENTPHONE_BOT_USERNAME     Bot display name override",
				].join("\n"),
			);
	}

	protected override readOptions(command: Command): ConnectAgentPhoneOptions {
		const opts = command.opts<{
			userName?: string;
			apiKey?: string;
			agentId?: string;
			webhookSecret?: string;
			apiUrl?: string;
			cwd?: string;
			model?: string;
			provider?: string;
			providerApiKey?: string;
			system?: string;
			mode?: string;
			interactive?: boolean;
			enableTools?: boolean;
			rpcAddress?: string;
			hookCommand?: string;
			port?: string;
			host?: string;
			baseUrl?: string;
		}>();
		const apiKey =
			opts.apiKey?.trim() || process.env.AGENTPHONE_API_KEY?.trim();
		const agentId =
			opts.agentId?.trim() || process.env.AGENTPHONE_AGENT_ID?.trim();
		if (!apiKey) {
			throw new Error(
				"connect agentphone requires --api-key <key> or AGENTPHONE_API_KEY",
			);
		}
		if (!agentId) {
			throw new Error(
				"connect agentphone requires --agent-id <id> or AGENTPHONE_AGENT_ID",
			);
		}
		const parsedPort =
			this.parseOptionalInteger(opts.port, "port") ??
			Number.parseInt(process.env.PORT ?? "8787", 10);
		const port = Number.isFinite(parsedPort) ? parsedPort : 8787;
		return {
			userName:
				opts.userName?.trim() ||
				process.env.AGENTPHONE_BOT_USERNAME?.trim() ||
				process.env.BOT_USERNAME?.trim(),
			apiKey,
			agentId,
			webhookSecret:
				opts.webhookSecret?.trim() ||
				process.env.AGENTPHONE_WEBHOOK_SECRET?.trim(),
			apiUrl: opts.apiUrl?.trim() || process.env.AGENTPHONE_API_URL?.trim(),
			cwd: opts.cwd || process.cwd(),
			model: opts.model,
			provider: opts.provider,
			apiProviderKey: opts.providerApiKey,
			systemPrompt: opts.system,
			mode: this.parseMode(opts.mode),
			interactive: Boolean(opts.interactive),
			enableTools: Boolean(opts.enableTools),
			rpcAddress:
				opts.rpcAddress?.trim() ||
				process.env.CLINE_RPC_ADDRESS?.trim() ||
				resolveDefaultCliRpcAddress(),
			hookCommand:
				opts.hookCommand?.trim() ||
				process.env.CLINE_CONNECT_HOOK_COMMAND?.trim(),
			port,
			host: opts.host?.trim() || process.env.HOST?.trim() || "0.0.0.0",
			baseUrl:
				opts.baseUrl?.trim() ||
				process.env.BASE_URL?.trim() ||
				`http://127.0.0.1:${port}`,
		};
	}

	private resolveConnectorStatePath(instanceKey: string): string {
		return this.resolveConnectorPath(`${instanceKey}.json`);
	}

	private resolveBindingsPath(instanceKey: string): string {
		return this.resolveConnectorPath(`${instanceKey}.threads.json`);
	}

	private listConnectorStatePaths(): string[] {
		return this.listJsonStatePaths([".threads.json"]);
	}

	private readConnectorState(
		statePath: string,
	): AgentPhoneConnectorState | undefined {
		return this.readStateFile(
			statePath,
			(value): value is AgentPhoneConnectorState =>
				Boolean(
					value &&
						typeof value === "object" &&
						typeof (value as AgentPhoneConnectorState).pid === "number" &&
						typeof (value as AgentPhoneConnectorState).instanceKey ===
							"string" &&
						typeof (value as AgentPhoneConnectorState).userName === "string" &&
						typeof (value as AgentPhoneConnectorState).agentId === "string" &&
						typeof (value as AgentPhoneConnectorState).agentPhoneNumber ===
							"string" &&
						typeof (value as AgentPhoneConnectorState).phoneNumberId ===
							"string",
				),
		);
	}

	private writeConnectorState(
		statePath: string,
		state: AgentPhoneConnectorState,
	): void {
		this.writeStateFile(statePath, state);
	}

	private async stopAgentPhoneConnectorInstance(
		statePath: string,
		io: ConnectIo,
	): Promise<ConnectStopResult> {
		return this.stopManagedProcess({
			io,
			statePath,
			readState: (path) => this.readConnectorState(path),
			describeStoppedProcess: (state) =>
				`[agentphone] stopped pid=${state.pid} user=${state.userName} agent=${state.agentId}`,
			getPid: (state) => state.pid,
			stopSessions: stopSessionsForConnector,
			clearBindings: (state) => {
				clearBindingSessionIds<AgentPhoneThreadState>(
					this.resolveBindingsPath(state.instanceKey),
				);
			},
		});
	}

	override async stopAll(io: ConnectIo): Promise<ConnectStopResult> {
		return this.stopAllFromStatePaths(
			io,
			this.listConnectorStatePaths(),
			(statePath, stopIo) =>
				this.stopAgentPhoneConnectorInstance(statePath, stopIo),
		);
	}

	protected override async runWithOptions(
		options: ConnectAgentPhoneOptions,
		rawArgs: string[],
		io: ConnectIo,
	): Promise<number> {
		const agentPhoneNumber = await fetchAgentPhoneNumber({
			apiKey: options.apiKey,
			agentId: options.agentId,
			apiUrl: options.apiUrl,
		});
		const connectorUserName =
			options.userName?.trim() || agentPhoneNumber.phoneNumber;
		io.writeln(
			`[agentphone] verified number ${agentPhoneNumber.phoneNumber} id=${agentPhoneNumber.id} type=${agentPhoneNumber.type || "unknown"}`,
		);
		const instanceKey = resolveInstanceKey({
			agentId: options.agentId,
			userName: connectorUserName,
		});
		const statePath = this.resolveConnectorStatePath(instanceKey);
		const bindingsPath = this.resolveBindingsPath(instanceKey);
		const staleState = this.removeStaleState(
			statePath,
			(path) => this.readConnectorState(path),
			(state) => state.pid,
		);
		if (staleState) {
			clearBindingSessionIds<AgentPhoneThreadState>(bindingsPath);
		}
		if (
			await this.maybeRunInBackground({
				rawArgs,
				io,
				interactive: options.interactive,
				childEnvVar: "CLINE_AGENTPHONE_CONNECT_CHILD",
				statePath,
				readState: (path) => this.readConnectorState(path),
				isRunning: (state) => isProcessRunning(state.pid),
				formatAlreadyRunningMessage: (state) =>
					`[agentphone] connector already running pid=${state.pid} rpc=${state.rpcAddress} url=${state.baseUrl}`,
				formatBackgroundStartMessage: (pid) =>
					`[agentphone] starting background connector pid=${pid} number=${agentPhoneNumber.phoneNumber} agent=${options.agentId}`,
				foregroundHint:
					"[agentphone] use `cline connect agentphone -i ...` to run in the foreground",
				launchFailureMessage:
					"failed to launch AgentPhone connector in background",
			})
		) {
			return 0;
		}

		const loggerAdapter = createCliLoggerAdapter({
			runtime: "cli",
			component: "agentphone-connect",
		});
		const logger = createChatSdkLogger(loggerAdapter);
		const consoleLogger = new ConsoleLogger("info", "agentphone-connect");
		const agentphoneConfig: Record<string, unknown> = {
			apiKey: options.apiKey,
			agentId: options.agentId,
			logger: consoleLogger,
			userName: connectorUserName,
		};
		if (options.webhookSecret?.trim()) {
			agentphoneConfig.webhookSecret = options.webhookSecret.trim();
		}
		if (options.apiUrl?.trim()) {
			agentphoneConfig.apiUrl = options.apiUrl.trim();
		}
		const agentphone = createAgentPhoneAdapter(agentphoneConfig);
		const bot = new Chat({
			userName: connectorUserName,
			adapters: { agentphone: agentphone as unknown as Adapter },
			state: new InMemoryStateAdapter(),
			logger,
			fallbackStreamingPlaceholderText: null,
			streamingUpdateIntervalMs: 500,
		}).registerSingleton();
		const threadQueues = new Map<string, Promise<void>>();
		const activeTurns = new Map<string, ActiveConnectorTurn>();
		const pendingApprovals = new Map<string, PendingConnectorApproval>();
		const startRequest = await buildAgentPhoneStartRequest(options, io, {
			enabled: loggerAdapter.runtimeConfig.enabled,
			level: loggerAdapter.runtimeConfig.level,
			destination: loggerAdapter.runtimeConfig.destination,
			bindings: {
				transport: "agentphone",
				userName: connectorUserName,
				agentId: options.agentId,
				agentPhoneNumber: agentPhoneNumber.phoneNumber,
				phoneNumberId: agentPhoneNumber.id,
			},
		});
		const userInstructionService = createUserInstructionConfigService({
			skills: { workspacePath: startRequest.cwd },
			rules: { workspacePath: startRequest.cwd },
			workflows: { workspacePath: startRequest.cwd },
		});
		await userInstructionService.start().catch(() => undefined);
		const commandCwd = startRequest.cwd || process.cwd();
		const { host: chatCommandHost } = await createWorkspaceChatCommandHost({
			cwd: commandCwd,
			workspaceRoot: startRequest.workspaceRoot || commandCwd,
		});
		const { url: rpcAddress, authToken: rpcAuthToken } =
			await ensureCliHubServer(
				startRequest.workspaceRoot || startRequest.cwd || process.cwd(),
				parseHubEndpointOverride(options.rpcAddress),
			);

		const clientId = `agentphone-${process.pid}-${Date.now()}`;
		const client = new HubSessionClient({
			address: rpcAddress,
			authToken: rpcAuthToken,
			clientId,
			clientType: "cli",
			displayName: "agentphone connector",
			workspaceRoot: startRequest.workspaceRoot || startRequest.cwd,
			cwd: startRequest.cwd,
			metadata: {
				transport: "agentphone",
				userName: connectorUserName,
				agentId: options.agentId,
				agentPhoneNumber: agentPhoneNumber.phoneNumber,
				phoneNumberId: agentPhoneNumber.id,
			},
		});
		await client.connect();
		this.writeConnectorState(statePath, {
			instanceKey,
			userName: connectorUserName,
			agentId: options.agentId,
			agentPhoneNumber: agentPhoneNumber.phoneNumber,
			phoneNumberId: agentPhoneNumber.id,
			phoneNumberCountry: agentPhoneNumber.country,
			phoneNumberStatus: agentPhoneNumber.status,
			phoneNumberType: agentPhoneNumber.type,
			pid: process.pid,
			rpcAddress,
			port: options.port,
			baseUrl: options.baseUrl,
			startedAt: new Date().toISOString(),
		});

		let stopping = false;
		let resolveStop: (() => void) | undefined;
		const stopPromise = new Promise<void>((resolve) => {
			resolveStop = resolve;
		});
		const requestStop = (_reason: string) => {
			if (stopping) {
				return;
			}
			stopping = true;
			resolveStop?.();
		};

		const handleTurn = async (
			thread: Thread<AgentPhoneThreadState>,
			text: string,
			delivery?: "thread" | "voice" | "webhook",
		): Promise<string | undefined> => {
			const queueKey =
				(await loadThreadState(thread, bindingsPath, startRequest))
					.participantKey || thread.id;
			let finalReplyText: string | undefined;
			const capturedReplies: string[] = [];
			const captureReplyText = async (replyText: string) => {
				capturedReplies.push(replyText);
			};
			const runTurn = async (): Promise<void> => {
				try {
					await handleConnectorUserTurn({
						thread,
						text,
						client,
						pendingApprovals,
						baseStartRequest: startRequest,
						explicitSystemPrompt:
							options.systemPrompt?.trim() ||
							getConnectorSystemPrompt("AgentPhone"),
						clientId,
						logger: loggerAdapter,
						transport: "agentphone",
						botUserName: connectorUserName,
						requestStop,
						bindingsPath,
						hookCommand: options.hookCommand,
						systemRules: AGENTPHONE_SYSTEM_RULES,
						errorLabel: "AgentPhone",
						firstContactMessage: AGENTPHONE_FIRST_CONTACT_MESSAGE,
						userInstructionService,
						chatCommandHost,
						activeTurns,
						turnKey: queueKey,
						getSessionMetadata: (currentThread, _clientId, currentState) => ({
							userName: connectorUserName,
							agentId: options.agentId,
							agentphoneThreadId: currentThread.id,
							agentphoneChannelId: currentThread.channelId,
							agentPhoneNumber: agentPhoneNumber.phoneNumber,
							phoneNumberId: agentPhoneNumber.id,
							...(currentState.participantKey
								? { agentphoneParticipantKey: currentState.participantKey }
								: {}),
							...(currentState.participantLabel
								? { agentphoneParticipantLabel: currentState.participantLabel }
								: {}),
						}),
						reusedLogMessage: "AgentPhone thread reusing RPC session",
						startedLogMessage: "AgentPhone thread started RPC session",
						onMessageReceived: async (details) => {
							await dispatchConnectorHook(
								options.hookCommand,
								{
									adapter: "agentphone",
									botUserName: connectorUserName,
									event: "message.received",
									payload: details,
									ts: new Date().toISOString(),
								},
								loggerAdapter,
							);
						},
						onReplyCompleted: async (result) => {
							finalReplyText = result.text;
							await dispatchConnectorHook(
								options.hookCommand,
								{
									adapter: "agentphone",
									botUserName: connectorUserName,
									event: "message.completed",
									payload: {
										threadId: result.threadId,
										sessionId: result.sessionId,
										finishReason: result.finishReason,
										iterations: result.iterations,
										outputPreview: truncateText(result.text),
										outputLength: result.text.length,
									},
									ts: new Date().toISOString(),
								},
								loggerAdapter,
							);
						},
						...(delivery === "voice"
							? {
									replyTextSink: captureReplyText,
									postFinalReply: async ({ text: replyText }) => {
										finalReplyText = replyText;
										await captureReplyText(replyText);
									},
								}
							: {
									postFinalReply: async ({
										thread: currentThread,
										text: replyText,
									}) => {
										finalReplyText = replyText;
										await postAgentPhoneReply({
											thread: currentThread,
											text: replyText,
											logger: loggerAdapter,
											io,
										});
									},
								}),
						onReplyFailed: async (details) => {
							await dispatchConnectorHook(
								options.hookCommand,
								{
									adapter: "agentphone",
									botUserName: connectorUserName,
									event: "message.failed",
									payload: {
										threadId: details.threadId,
										sessionId: details.sessionId,
										error: details.error.message,
									},
									ts: new Date().toISOString(),
								},
								loggerAdapter,
							);
						},
					});
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					loggerAdapter.core.error?.("AgentPhone turn failed", {
						transport: "agentphone",
						threadId: thread.id,
						channelId: thread.channelId,
						error,
					});
					io.writeln(
						`[agentphone] turn failed thread=${thread.id} error=${message}`,
					);
					if (delivery === "voice") {
						finalReplyText = `AgentPhone bridge error: ${message}`;
						await captureReplyText(finalReplyText);
					} else if (delivery === "webhook") {
						throw error;
					} else {
						await thread
							.post(`AgentPhone bridge error: ${message}`)
							.catch((postError: unknown) => {
								const postMessage =
									postError instanceof Error
										? postError.message
										: String(postError);
								loggerAdapter.core.error?.(
									"AgentPhone bridge error reply failed",
									{
										transport: "agentphone",
										threadId: thread.id,
										channelId: thread.channelId,
										error: postError,
									},
								);
								io.writeln(
									`[agentphone] failed to send bridge error thread=${thread.id} error=${postMessage}`,
								);
							});
					}
				}
			};
			if (activeTurns.has(queueKey)) {
				await runTurn();
				return finalReplyText ?? capturedReplies.at(-1);
			}
			await enqueueThreadTurn(threadQueues, queueKey, async () => {
				await runTurn();
			});
			return finalReplyText ?? capturedReplies.at(-1);
		};

		bot.onNewMention(async (thread, message) => {
			await thread.subscribe();
			await persistAgentPhoneThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: message.raw,
				errorLabel: "AgentPhone",
			});
			if (
				await maybeHandleConnectorApprovalReply({
					thread,
					text: message.text,
					client,
					clientId,
					pendingApprovals,
					deniedReason: "Denied by AgentPhone user",
				})
			) {
				return;
			}
			await handleTurn(thread, message.text);
		});

		bot.onSubscribedMessage(async (thread, message) => {
			await persistAgentPhoneThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: message.raw,
				errorLabel: "AgentPhone",
			});
			if (
				await maybeHandleConnectorApprovalReply({
					thread,
					text: message.text,
					client,
					clientId,
					pendingApprovals,
					deniedReason: "Denied by AgentPhone user",
				})
			) {
				return;
			}
			await handleTurn(thread, message.text);
		});

		await bot.initialize();
		const stopTaskUpdateStream =
			startConnectorTaskUpdateRelay<AgentPhoneThreadState>({
				client,
				clientId,
				bot,
				logger: loggerAdapter,
				bindingsPath,
				transport: "agentphone",
			});

		const webhookUrl = `${options.baseUrl.replace(/\/$/, "")}/api/webhooks/agentphone`;
		const debugWebhook = isAgentPhoneDebugEnabled();
		const writeWebhookDebug = (input: {
			phase: "received" | "responded" | "background_error";
			payload?: Record<string, unknown>;
			response?: Response;
			error?: string;
		}) => {
			if (!debugWebhook) {
				return;
			}
			const line = formatAgentPhoneDebugLine({
				phase: input.phase,
				event: readString(input.payload?.event),
				channel: readString(input.payload?.channel),
				status: input.response?.status,
				contentType: input.response?.headers.get("content-type") ?? undefined,
				error: input.error,
			});
			io.writeln(line);
			loggerAdapter.core.log(line);
		};
		const server = await startConnectorWebhookServer({
			host: options.host,
			port: options.port,
			routes: {
				"/api/webhooks/agentphone": async (request) => {
					const rawBody = await request
						.clone()
						.text()
						.catch(() => "");
					const payload = parseJsonRecord(rawBody);
					writeWebhookDebug({ phase: "received", payload });
					if (isVoiceWebhookPayload(payload)) {
						if (
							!verifyAgentPhoneWebhookSignature({
								rawBody,
								secret: options.webhookSecret,
								signature: request.headers.get("x-webhook-signature"),
							})
						) {
							const response = Response.json(
								{ error: "Invalid signature" },
								{ status: 401 },
							);
							writeWebhookDebug({ phase: "responded", payload, response });
							return response;
						}
						if (!isAgentPhoneVoiceMessagePayload(payload)) {
							const response = Response.json({ ok: true });
							writeWebhookDebug({ phase: "responded", payload, response });
							return response;
						}
						const voiceTurn = resolveAgentPhoneVoiceTurnPayload(payload);
						if (!voiceTurn) {
							const response = Response.json({
								text: "I did not receive any speech to respond to.",
							});
							writeWebhookDebug({ phase: "responded", payload, response });
							return response;
						}
						const response = agentPhoneVoiceResponse(async () => {
							const thread = bot.thread(
								voiceTurn.threadId,
							) as Thread<AgentPhoneThreadState>;
							await persistAgentPhoneThreadContext({
								thread,
								bindingsPath,
								baseStartRequest: startRequest,
								rawMessage: voiceTurn.rawMessage,
								errorLabel: "AgentPhone",
							});
							if (
								await maybeHandleConnectorApprovalReply({
									thread,
									text: voiceTurn.text,
									client,
									clientId,
									pendingApprovals,
									deniedReason: "Denied by AgentPhone user",
								})
							) {
								return "Okay.";
							}
							return await handleTurn(thread, voiceTurn.text, "voice");
						});
						writeWebhookDebug({ phase: "responded", payload, response });
						return response;
					}
					if (isMessageWebhookPayload(payload)) {
						if (
							!verifyAgentPhoneWebhookSignature({
								rawBody,
								secret: options.webhookSecret,
								signature: request.headers.get("x-webhook-signature"),
							})
						) {
							const response = Response.json(
								{ error: "Invalid signature" },
								{ status: 401 },
							);
							writeWebhookDebug({ phase: "responded", payload, response });
							return response;
						}
						const messageTurn = resolveAgentPhoneMessageTurnPayload(payload);
						if (!messageTurn) {
							const response = Response.json({ ok: true });
							writeWebhookDebug({ phase: "responded", payload, response });
							return response;
						}
						const thread = bot.thread(
							messageTurn.threadId,
						) as Thread<AgentPhoneThreadState>;
						await thread.subscribe();
						await persistAgentPhoneThreadContext({
							thread,
							bindingsPath,
							baseStartRequest: startRequest,
							rawMessage: messageTurn.rawMessage,
							errorLabel: "AgentPhone",
						});
						try {
							if (
								!(await maybeHandleConnectorApprovalReply({
									thread,
									text: messageTurn.text,
									client,
									clientId,
									pendingApprovals,
									deniedReason: "Denied by AgentPhone user",
								}))
							) {
								await handleTurn(thread, messageTurn.text, "webhook");
							}
							const response = Response.json({ ok: true });
							writeWebhookDebug({ phase: "responded", payload, response });
							return response;
						} catch (error) {
							const message = formatAgentPhoneRequestError(error);
							const response = Response.json(
								{ error: message },
								{ status: 502 },
							);
							writeWebhookDebug({
								phase: "responded",
								payload,
								response,
								error: message,
							});
							return response;
						}
					}
					const response = await agentphone.handleWebhook(request);
					const normalizedResponse = await normalizeAgentPhoneWebhookResponse({
						response,
						payload,
					});
					writeWebhookDebug({
						phase: "responded",
						payload,
						response: normalizedResponse,
					});
					return normalizedResponse;
				},
				"/health": () => new Response("ok"),
				"/": () =>
					new Response(
						[
							"AgentPhone connector is running.",
							`Webhook URL: ${webhookUrl}`,
						].join("\n"),
					),
			},
		});

		const stopEventStream = client.streamEvents(
			{ clientId: `${clientId}-server-events` },
			{
				onEvent: (event) => {
					if (event.eventType === "rpc.server.shutting_down") {
						requestStop("rpc_server_shutting_down");
						return;
					}
					if (
						event.eventType !== "schedule.execution.completed" &&
						event.eventType !== "schedule.execution.failed"
					) {
						return;
					}
					const scheduleId =
						typeof event.payload.scheduleId === "string"
							? event.payload.scheduleId.trim()
							: "";
					const executionId =
						typeof event.payload.executionId === "string"
							? event.payload.executionId.trim()
							: "";
					const sessionId =
						typeof event.payload.sessionId === "string"
							? event.payload.sessionId.trim()
							: undefined;
					const status =
						typeof event.payload.status === "string"
							? event.payload.status.trim()
							: "";
					const errorMessage =
						typeof event.payload.errorMessage === "string"
							? event.payload.errorMessage
							: undefined;
					if (!scheduleId || !executionId || !status) {
						return;
					}
					void deliverScheduledResult({
						bot,
						client,
						logger: loggerAdapter,
						bindingsPath,
						options: { ...options, userName: connectorUserName },
						scheduleId,
						executionId,
						sessionId,
						status,
						errorMessage,
						hookCommand: options.hookCommand,
					});
				},
				onError: () => {
					requestStop("rpc_server_event_stream_failed");
				},
			},
		);

		process.once("SIGINT", () => requestStop("sigint"));
		process.once("SIGTERM", () => requestStop("sigterm"));

		io.writeln(`[agentphone] listening on ${options.host}:${options.port}`);
		io.writeln(`[agentphone] configure AgentPhone webhook URL: ${webhookUrl}`);

		await stopPromise;
		clearBindingSessionIds<AgentPhoneThreadState>(bindingsPath);
		stopTaskUpdateStream();
		stopEventStream();
		await server.close();
		userInstructionService.stop();
		await bot.shutdown().catch(() => undefined);
		client.close();
		this.removeStateFile(statePath);
		return 0;
	}
}

export const agentPhoneConnector: ConnectCommandDefinition =
	new AgentPhoneConnector();

export const __test__ = {
	findBindingForThread: (
		bindings: ConnectorBindingStore<AgentPhoneThreadState>,
		thread: Pick<Thread<AgentPhoneThreadState>, "id" | "channelId" | "isDM"> & {
			participantKey?: string;
		},
	) => findBindingForThread(bindings, thread),
	fetchAgentPhoneNumber,
	selectAgentPhoneNumber,
	resolveAgentPhoneParticipant: (rawMessage: AgentPhoneRawMessage) =>
		resolveAgentPhoneParticipant(rawMessage),
	resolveAgentPhoneMessageTurnPayload,
	resolveAgentPhoneVoiceTurnPayload,
	isAgentPhoneVoiceMessagePayload,
	verifyAgentPhoneWebhookSignature,
	normalizeAgentPhoneWebhookResponse,
	formatAgentPhoneRequestError,
	agentPhoneVoiceResponse,
	postAgentPhoneReply,
};
