import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
import type { RpcChatStartSessionRequest } from "@clinebot/core";
import { resolveClineDataDir } from "@clinebot/core";
import { RpcSessionClient, registerRpcClient } from "@clinebot/rpc";
import { Chat, ConsoleLogger, type Thread } from "chat";
import { ensureRpcRuntimeAddress } from "../../commands/rpc";
import type { CliLoggerAdapter } from "../../logging/adapter";
import { createCliLoggerAdapter } from "../../logging/adapter";
import {
	createChatSdkLogger,
	enqueueThreadTurn,
	InMemoryStateAdapter,
	startConnectorWebhookServer,
} from "../chat-runtime";
import {
	isProcessRunning,
	parseBooleanFlag,
	parseIntegerFlag,
	parseStringFlag,
	readJsonFile,
	removeFile,
	spawnDetachedConnector,
	terminateProcess,
	writeJsonFile,
} from "../common";
import {
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
import { startConnectorTaskUpdateRelay } from "../task-updates";
import {
	type ConnectorBindingStore,
	type ConnectorThreadState,
	clearBindingSessionIds,
	findBindingForThread,
	readBindings,
} from "../thread-bindings";
import type {
	ConnectCommandDefinition,
	ConnectIo,
	ConnectStopResult,
} from "../types";

const WHATSAPP_SYSTEM_RULES = [
	"Keep answers compact and optimized for a chat app unless the user asks for detail.",
	"Prefer short paragraphs and concise lists suitable for WhatsApp.",
	"When tools are disabled, explain limits briefly and ask for /tools if tool usage is required.",
].join("\n");

type WhatsAppThreadState = ConnectorThreadState;

type ConnectWhatsAppOptions = {
	userName: string;
	phoneNumberId?: string;
	accessToken?: string;
	appSecret?: string;
	verifyToken?: string;
	apiVersion?: string;
	cwd: string;
	model?: string;
	provider?: string;
	apiKey?: string;
	systemPrompt?: string;
	mode: "act" | "plan";
	interactive: boolean;
	maxIterations?: number;
	enableTools: boolean;
	rpcAddress: string;
	hookCommand?: string;
	port: number;
	host: string;
	baseUrl: string;
};

type WhatsAppConnectorState = {
	instanceKey: string;
	userName: string;
	phoneNumberId?: string;
	pid: number;
	rpcAddress: string;
	port: number;
	baseUrl: string;
	startedAt: string;
};

function truncateText(value: string, maxLength = 160): string {
	return truncateConnectorText(value, maxLength);
}

function resolveInstanceKey(input: {
	phoneNumberId?: string;
	userName: string;
}): string {
	return (input.phoneNumberId?.trim() || input.userName).replace(
		/[^a-zA-Z0-9._-]+/g,
		"_",
	);
}

function resolveConnectorStatePath(instanceKey: string): string {
	return join(
		resolveClineDataDir(),
		"connectors",
		"whatsapp",
		`${instanceKey}.json`,
	);
}

function resolveBindingsPath(instanceKey: string): string {
	return join(
		resolveClineDataDir(),
		"connectors",
		"whatsapp",
		`${instanceKey}.threads.json`,
	);
}

function listConnectorStatePaths(): string[] {
	const dir = join(resolveClineDataDir(), "connectors", "whatsapp");
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json") && !name.endsWith(".threads.json"))
		.map((name) => join(dir, name));
}

function readConnectorState(
	statePath: string,
): WhatsAppConnectorState | undefined {
	const parsed = readJsonFile<WhatsAppConnectorState | undefined>(
		statePath,
		undefined,
	);
	if (
		!parsed ||
		typeof parsed !== "object" ||
		typeof parsed.pid !== "number" ||
		typeof parsed.instanceKey !== "string" ||
		typeof parsed.userName !== "string"
	) {
		return undefined;
	}
	return parsed;
}

function writeConnectorState(
	statePath: string,
	state: WhatsAppConnectorState,
): void {
	writeJsonFile(statePath, state);
}

function removeConnectorState(statePath: string): void {
	removeFile(statePath);
}

async function stopSessionsForConnector(
	state: WhatsAppConnectorState,
): Promise<number> {
	return stopConnectorSessions({
		rpcAddress: state.rpcAddress,
		rpcMatcher: (metadata) =>
			metadata?.transport === "whatsapp" &&
			(state.phoneNumberId?.trim()
				? metadata?.phoneNumberId === state.phoneNumberId.trim()
				: metadata?.userName === state.userName),
		localMatcher: (metadata) =>
			metadata?.transport === "whatsapp" &&
			(state.phoneNumberId?.trim()
				? metadata?.phoneNumberId === state.phoneNumberId.trim()
				: metadata?.userName === state.userName),
	});
}

async function stopWhatsAppConnectorInstance(
	statePath: string,
	io: ConnectIo,
): Promise<ConnectStopResult> {
	const state = readConnectorState(statePath);
	if (!state) {
		removeConnectorState(statePath);
		return { stoppedProcesses: 0, stoppedSessions: 0 };
	}
	let stoppedProcesses = 0;
	if (await terminateProcess(state.pid)) {
		stoppedProcesses = 1;
		io.writeln(
			`[whatsapp] stopped pid=${state.pid} user=${state.userName}${state.phoneNumberId ? ` phone=${state.phoneNumberId}` : ""}`,
		);
	}
	const stoppedSessions = await stopSessionsForConnector(state);
	clearBindingSessionIds<WhatsAppThreadState>(
		resolveBindingsPath(state.instanceKey),
	);
	removeConnectorState(statePath);
	return { stoppedProcesses, stoppedSessions };
}

function showConnectWhatsAppHelp(io: ConnectIo): void {
	io.writeln("Usage:");
	io.writeln("  clite connect whatsapp --base-url <PUBLIC_BASE_URL> [options]");
	io.writeln("");
	io.writeln("Options:");
	io.writeln("  --user-name <name>          WhatsApp bot username label");
	io.writeln("  --phone-number-id <id>      WhatsApp Business phone number id");
	io.writeln("  --access-token <token>      Meta access token");
	io.writeln("  --app-secret <secret>       Meta app secret");
	io.writeln("  --verify-token <token>      Webhook verify token");
	io.writeln(
		"  --api-version <version>     Graph API version (default: v21.0)",
	);
	io.writeln("  --provider <id>             Provider override");
	io.writeln("  --model <id>                Model override");
	io.writeln("  --api-key <key>             Provider API key override");
	io.writeln("  --system <prompt>           System prompt override");
	io.writeln("  --cwd <path>                Workspace / cwd for runtime");
	io.writeln("  --mode <act|plan>           Agent mode (default: act)");
	io.writeln("  -i, --interactive           Keep connector in foreground");
	io.writeln("  --max-iterations <n>        Optional max iterations");
	io.writeln(
		"  --enable-tools              Enable tools for WhatsApp sessions",
	);
	io.writeln(
		"  --hook-command <command>    Run a shell command for connector events",
	);
	io.writeln(
		"  --rpc-address <host:port>   RPC address (default: 127.0.0.1:4317)",
	);
	io.writeln(
		"  --host <host>               Webhook listen host (default: 0.0.0.0)",
	);
	io.writeln(
		"  --port <port>               Webhook listen port (default: 8787)",
	);
	io.writeln(
		"  --base-url <url>            Public base URL for webhook configuration",
	);
	io.writeln("");
	io.writeln("Environment:");
	io.writeln("  WHATSAPP_ACCESS_TOKEN       Meta access token");
	io.writeln("  WHATSAPP_APP_SECRET         Meta app secret");
	io.writeln("  WHATSAPP_PHONE_NUMBER_ID    WhatsApp Business phone number id");
	io.writeln("  WHATSAPP_VERIFY_TOKEN       Webhook verification token");
	io.writeln("  WHATSAPP_BOT_USERNAME       Bot username label");
}

function parseConnectWhatsAppArgs(
	connectArgs: string[],
): ConnectWhatsAppOptions {
	if (
		parseBooleanFlag(connectArgs, "-h") ||
		parseBooleanFlag(connectArgs, "--help")
	) {
		throw new Error("__SHOW_HELP__");
	}

	const modeRaw =
		parseStringFlag(connectArgs, "", "--mode")?.toLowerCase() || "act";
	if (modeRaw !== "act" && modeRaw !== "plan") {
		throw new Error(`invalid mode "${modeRaw}" (expected "act" or "plan")`);
	}

	const port =
		parseIntegerFlag(connectArgs, "", "--port") ||
		Number.parseInt(process.env.PORT ?? "8787", 10);
	const resolvedPort = Number.isFinite(port) ? port : 8787;
	const baseUrl =
		parseStringFlag(connectArgs, "", "--base-url") ||
		process.env.BASE_URL?.trim() ||
		`http://127.0.0.1:${resolvedPort}`;

	return {
		userName:
			parseStringFlag(connectArgs, "", "--user-name") ||
			process.env.WHATSAPP_BOT_USERNAME?.trim() ||
			"whatsapp-bot",
		phoneNumberId:
			parseStringFlag(connectArgs, "", "--phone-number-id") ||
			process.env.WHATSAPP_PHONE_NUMBER_ID?.trim(),
		accessToken:
			parseStringFlag(connectArgs, "", "--access-token") ||
			process.env.WHATSAPP_ACCESS_TOKEN?.trim(),
		appSecret:
			parseStringFlag(connectArgs, "", "--app-secret") ||
			process.env.WHATSAPP_APP_SECRET?.trim(),
		verifyToken:
			parseStringFlag(connectArgs, "", "--verify-token") ||
			process.env.WHATSAPP_VERIFY_TOKEN?.trim(),
		apiVersion: parseStringFlag(connectArgs, "", "--api-version") || "v21.0",
		cwd: parseStringFlag(connectArgs, "", "--cwd") || process.cwd(),
		model: parseStringFlag(connectArgs, "", "--model"),
		provider: parseStringFlag(connectArgs, "", "--provider"),
		apiKey: parseStringFlag(connectArgs, "", "--api-key"),
		systemPrompt: parseStringFlag(connectArgs, "-s", "--system"),
		mode: modeRaw,
		interactive:
			parseBooleanFlag(connectArgs, "-i") ||
			parseBooleanFlag(connectArgs, "--interactive"),
		maxIterations: parseIntegerFlag(connectArgs, "-n", "--max-iterations"),
		enableTools: parseBooleanFlag(connectArgs, "--enable-tools"),
		rpcAddress:
			parseStringFlag(connectArgs, "", "--rpc-address") ||
			process.env.CLINE_RPC_ADDRESS?.trim() ||
			"127.0.0.1:4317",
		hookCommand:
			parseStringFlag(connectArgs, "", "--hook-command") ||
			process.env.CLINE_CONNECT_HOOK_COMMAND?.trim(),
		port: resolvedPort,
		host:
			parseStringFlag(connectArgs, "", "--host") ||
			process.env.HOST?.trim() ||
			"0.0.0.0",
		baseUrl,
	};
}

async function buildWhatsAppStartRequest(
	options: ConnectWhatsAppOptions,
	io: ConnectIo,
	loggerConfig: Parameters<
		typeof buildConnectorStartRequest
	>[0]["loggerConfig"],
): Promise<RpcChatStartSessionRequest> {
	const instanceKey = resolveInstanceKey({
		phoneNumberId: options.phoneNumberId,
		userName: options.userName,
	});
	return buildConnectorStartRequest({
		options,
		io,
		loggerConfig,
		systemRules: WHATSAPP_SYSTEM_RULES,
		teamName: `whatsapp-${instanceKey.replace(/[^a-zA-Z0-9_-]+/g, "-")}`,
	});
}

async function deliverScheduledResult(input: {
	bot: Chat;
	client: RpcSessionClient;
	logger: CliLoggerAdapter;
	bindingsPath: string;
	options: ConnectWhatsAppOptions;
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
	if (!delivery || delivery.adapter !== "whatsapp") {
		return;
	}
	const targetPhoneNumberId =
		typeof delivery.phoneNumberId === "string"
			? delivery.phoneNumberId.trim()
			: "";
	if (
		targetPhoneNumberId &&
		input.options.phoneNumberId?.trim() &&
		targetPhoneNumberId !== input.options.phoneNumberId.trim()
	) {
		return;
	}
	const targetUserName =
		typeof delivery.userName === "string" ? delivery.userName.trim() : "";
	if (targetUserName && targetUserName !== input.options.userName) {
		return;
	}
	const threadId =
		typeof delivery.threadId === "string" ? delivery.threadId.trim() : "";
	if (!threadId) {
		return;
	}
	const binding = readBindings<WhatsAppThreadState>(input.bindingsPath)[
		threadId
	];
	if (!binding?.serializedThread) {
		return;
	}
	const thread = JSON.parse(
		binding.serializedThread,
		input.bot.reviver(),
	) as Thread<WhatsAppThreadState>;
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

async function runConnectWhatsAppCommand(
	rawArgs: string[],
	io: ConnectIo,
): Promise<number> {
	let options: ConnectWhatsAppOptions;
	try {
		options = parseConnectWhatsAppArgs(rawArgs);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === "__SHOW_HELP__") {
			showConnectWhatsAppHelp(io);
			return 0;
		}
		io.writeErr(message);
		return 1;
	}

	const instanceKey = resolveInstanceKey({
		phoneNumberId: options.phoneNumberId,
		userName: options.userName,
	});
	const statePath = resolveConnectorStatePath(instanceKey);
	const bindingsPath = resolveBindingsPath(instanceKey);
	const existingState = readConnectorState(statePath);
	if (existingState && !isProcessRunning(existingState.pid)) {
		removeConnectorState(statePath);
	}
	if (
		!options.interactive &&
		process.env.CLINE_WHATSAPP_CONNECT_CHILD !== "1"
	) {
		const runningState = readConnectorState(statePath);
		if (runningState && isProcessRunning(runningState.pid)) {
			io.writeln(
				`[whatsapp] connector already running pid=${runningState.pid} rpc=${runningState.rpcAddress} url=${runningState.baseUrl}`,
			);
			return 0;
		}
		const pid = spawnDetachedConnector(
			["connect", "whatsapp"],
			rawArgs,
			"CLINE_WHATSAPP_CONNECT_CHILD",
		);
		if (!pid) {
			io.writeErr("failed to launch WhatsApp connector in background");
			return 1;
		}
		io.writeln(
			`[whatsapp] starting background connector pid=${pid} user=${options.userName}`,
		);
		io.writeln(
			"[whatsapp] use `clite connect whatsapp -i ...` to run in the foreground",
		);
		return 0;
	}

	const loggerAdapter = createCliLoggerAdapter({
		runtime: "cli",
		component: "whatsapp-connect",
	});
	const logger = createChatSdkLogger(loggerAdapter);
	const consoleLogger = new ConsoleLogger("info", "whatsapp-connect");
	const whatsappConfig: Record<string, unknown> = {
		logger: consoleLogger,
		userName: options.userName,
	};
	if (options.accessToken?.trim()) {
		whatsappConfig.accessToken = options.accessToken.trim();
	}
	if (options.appSecret?.trim()) {
		whatsappConfig.appSecret = options.appSecret.trim();
	}
	if (options.phoneNumberId?.trim()) {
		whatsappConfig.phoneNumberId = options.phoneNumberId.trim();
	}
	if (options.verifyToken?.trim()) {
		whatsappConfig.verifyToken = options.verifyToken.trim();
	}
	if (options.apiVersion?.trim()) {
		whatsappConfig.apiVersion = options.apiVersion.trim();
	}
	const whatsapp = createWhatsAppAdapter(whatsappConfig);
	const bot = new Chat({
		userName: options.userName,
		adapters: { whatsapp },
		state: new InMemoryStateAdapter(),
		logger,
		fallbackStreamingPlaceholderText: null,
		streamingUpdateIntervalMs: 500,
	}).registerSingleton();
	const threadQueues = new Map<string, Promise<void>>();
	const pendingApprovals = new Map<string, PendingConnectorApproval>();
	const startRequest = await buildWhatsAppStartRequest(options, io, {
		enabled: loggerAdapter.runtimeConfig.enabled,
		level: loggerAdapter.runtimeConfig.level,
		destination: loggerAdapter.runtimeConfig.destination,
		bindings: {
			transport: "whatsapp",
			userName: options.userName,
			...(options.phoneNumberId
				? { phoneNumberId: options.phoneNumberId }
				: {}),
		},
	});
	const rpcAddress = await ensureRpcRuntimeAddress(options.rpcAddress);
	process.env.CLINE_RPC_ADDRESS = rpcAddress;

	const clientId = `whatsapp-${process.pid}-${Date.now()}`;
	await registerRpcClient(rpcAddress, {
		clientId,
		clientType: "cli",
		metadata: {
			transport: "whatsapp",
			userName: options.userName,
			...(options.phoneNumberId
				? { phoneNumberId: options.phoneNumberId }
				: {}),
		},
	}).catch(() => undefined);

	const client = new RpcSessionClient({ address: rpcAddress });
	writeConnectorState(statePath, {
		instanceKey,
		userName: options.userName,
		phoneNumberId: options.phoneNumberId,
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
		thread: Thread<WhatsAppThreadState>,
		text: string,
	) => {
		await enqueueThreadTurn(threadQueues, thread.id, async () => {
			try {
				await handleConnectorUserTurn({
					thread,
					text,
					client,
					pendingApprovals,
					baseStartRequest: startRequest,
					explicitSystemPrompt: options.systemPrompt?.trim() || undefined,
					clientId,
					logger: loggerAdapter,
					transport: "whatsapp",
					botUserName: options.userName,
					requestStop,
					bindingsPath,
					hookCommand: options.hookCommand,
					systemRules: WHATSAPP_SYSTEM_RULES,
					errorLabel: "WhatsApp",
					getSessionMetadata: (currentThread) => ({
						userName: options.userName,
						phoneNumberId: options.phoneNumberId,
						whatsappThreadId: currentThread.id,
						whatsappChannelId: currentThread.channelId,
					}),
					reusedLogMessage: "WhatsApp thread reusing RPC session",
					startedLogMessage: "WhatsApp thread started RPC session",
					onMessageReceived: async (details) => {
						await dispatchConnectorHook(
							options.hookCommand,
							{
								adapter: "whatsapp",
								botUserName: options.userName,
								event: "message.received",
								payload: details,
								ts: new Date().toISOString(),
							},
							loggerAdapter,
						);
					},
					onReplyCompleted: async (result) => {
						await dispatchConnectorHook(
							options.hookCommand,
							{
								adapter: "whatsapp",
								botUserName: options.userName,
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
					onReplyFailed: async (details) => {
						await dispatchConnectorHook(
							options.hookCommand,
							{
								adapter: "whatsapp",
								botUserName: options.userName,
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
				const message = error instanceof Error ? error.message : String(error);
				await thread.post(`WhatsApp bridge error: ${message}`);
			}
		});
	};

	bot.onNewMention(async (thread, message) => {
		await thread.subscribe();
		if (
			await maybeHandleConnectorApprovalReply({
				thread,
				text: message.text,
				client,
				clientId,
				pendingApprovals,
				deniedReason: "Denied by WhatsApp user",
			})
		) {
			return;
		}
		await handleTurn(thread, message.text);
	});

	bot.onSubscribedMessage(async (thread, message) => {
		if (
			await maybeHandleConnectorApprovalReply({
				thread,
				text: message.text,
				client,
				clientId,
				pendingApprovals,
				deniedReason: "Denied by WhatsApp user",
			})
		) {
			return;
		}
		await handleTurn(thread, message.text);
	});

	await bot.initialize();
	const stopTaskUpdateStream =
		startConnectorTaskUpdateRelay<WhatsAppThreadState>({
			client,
			clientId,
			bot,
			logger: loggerAdapter,
			bindingsPath,
			transport: "whatsapp",
		});

	const endpointUrl = `${options.baseUrl.replace(/\/$/, "")}/api/webhooks/whatsapp`;
	const server = await startConnectorWebhookServer({
		host: options.host,
		port: options.port,
		routes: {
			"/api/webhooks/whatsapp": async (request) =>
				whatsapp.handleWebhook(request),
			"/health": () => new Response("ok"),
			"/": () =>
				new Response(
					[
						"WhatsApp connector is running.",
						`Webhook URL: ${endpointUrl}`,
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
				if (event.eventType !== "schedule.execution.completed") {
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
					options,
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

	io.writeln(`[whatsapp] listening on ${options.host}:${options.port}`);
	io.writeln(`[whatsapp] configure WhatsApp webhook URL: ${endpointUrl}`);

	await stopPromise;
	stopTaskUpdateStream();
	stopEventStream();
	await server.close();
	client.close();
	removeConnectorState(statePath);
	return 0;
}

async function stopAllWhatsAppConnectors(
	io: ConnectIo,
): Promise<ConnectStopResult> {
	let stoppedProcesses = 0;
	let stoppedSessions = 0;
	for (const statePath of listConnectorStatePaths()) {
		const result = await stopWhatsAppConnectorInstance(statePath, io);
		stoppedProcesses += result.stoppedProcesses;
		stoppedSessions += result.stoppedSessions;
	}
	return { stoppedProcesses, stoppedSessions };
}

export const whatsappConnector: ConnectCommandDefinition = {
	name: "whatsapp",
	description:
		"WhatsApp Business webhook bridge backed by RPC runtime sessions",
	run: runConnectWhatsAppCommand,
	showHelp: showConnectWhatsAppHelp,
	stopAll: stopAllWhatsAppConnectors,
};

export const __test__ = {
	findBindingForThread: (
		bindings: ConnectorBindingStore<WhatsAppThreadState>,
		thread: Pick<Thread<WhatsAppThreadState>, "id" | "channelId" | "isDM">,
	) => findBindingForThread(bindings, thread),
};
