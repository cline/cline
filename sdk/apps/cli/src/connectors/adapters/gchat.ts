import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createGoogleChatAdapter } from "@chat-adapter/gchat";
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
import { InMemoryStateAdapter } from "../stores/memory-state";
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

const GCHAT_SYSTEM_RULES = [
	"Keep answers compact and optimized for a chat app unless the user asks for detail.",
	"Prefer short paragraphs and concise lists suitable for Google Chat.",
	"When tools are disabled, explain limits briefly and ask for /tools if tool usage is required.",
].join("\n");

type GoogleChatThreadState = ConnectorThreadState;

type ConnectGoogleChatOptions = {
	userName: string;
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
	pubsubTopic?: string;
	impersonateUser?: string;
	useApplicationDefaultCredentials: boolean;
	credentialsJson?: string;
};

type GoogleChatConnectorState = {
	userName: string;
	pid: number;
	rpcAddress: string;
	port: number;
	baseUrl: string;
	startedAt: string;
};

function truncateText(value: string, maxLength = 160): string {
	return truncateConnectorText(value, maxLength);
}

function sanitizeKey(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function resolveConnectorStatePath(userName: string): string {
	return join(
		resolveClineDataDir(),
		"connectors",
		"gchat",
		`${sanitizeKey(userName)}.json`,
	);
}

function resolveBindingsPath(userName: string): string {
	return join(
		resolveClineDataDir(),
		"connectors",
		"gchat",
		`${sanitizeKey(userName)}.threads.json`,
	);
}

function listConnectorStatePaths(): string[] {
	const dir = join(resolveClineDataDir(), "connectors", "gchat");
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json") && !name.endsWith(".threads.json"))
		.map((name) => join(dir, name));
}

function readConnectorState(
	statePath: string,
): GoogleChatConnectorState | undefined {
	const parsed = readJsonFile<GoogleChatConnectorState | undefined>(
		statePath,
		undefined,
	);
	if (
		!parsed ||
		typeof parsed !== "object" ||
		typeof parsed.pid !== "number" ||
		typeof parsed.userName !== "string"
	) {
		return undefined;
	}
	return parsed;
}

function writeConnectorState(
	statePath: string,
	state: GoogleChatConnectorState,
): void {
	writeJsonFile(statePath, state);
}

function removeConnectorState(statePath: string): void {
	removeFile(statePath);
}

async function stopSessionsForUser(
	state: GoogleChatConnectorState,
): Promise<number> {
	return stopConnectorSessions({
		rpcAddress: state.rpcAddress,
		rpcMatcher: (metadata) =>
			metadata?.transport === "gchat" && metadata?.userName === state.userName,
		localMatcher: (metadata) =>
			metadata?.transport === "gchat" && metadata?.userName === state.userName,
	});
}

async function stopGoogleChatConnectorInstance(
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
		io.writeln(`[gchat] stopped pid=${state.pid} user=${state.userName}`);
	}
	const stoppedSessions = await stopSessionsForUser(state);
	clearBindingSessionIds<GoogleChatThreadState>(
		resolveBindingsPath(state.userName),
	);
	removeConnectorState(statePath);
	return { stoppedProcesses, stoppedSessions };
}

function showConnectGoogleChatHelp(io: ConnectIo): void {
	io.writeln("Usage:");
	io.writeln("  clite connect gchat --base-url <PUBLIC_BASE_URL> [options]");
	io.writeln("");
	io.writeln("Options:");
	io.writeln("  --user-name <name>          Google Chat bot username label");
	io.writeln("  --provider <id>             Provider override");
	io.writeln("  --model <id>                Model override");
	io.writeln("  --api-key <key>             Provider API key override");
	io.writeln("  --system <prompt>           System prompt override");
	io.writeln("  --cwd <path>                Workspace / cwd for runtime");
	io.writeln("  --mode <act|plan>           Agent mode (default: act)");
	io.writeln("  -i, --interactive           Keep connector in foreground");
	io.writeln("  --max-iterations <n>        Optional max iterations");
	io.writeln(
		"  --enable-tools              Enable tools for Google Chat sessions",
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
	io.writeln(
		"  --pubsub-topic <topic>      Optional Pub/Sub topic for all-message events",
	);
	io.writeln("  --impersonate-user <email>  Optional delegation user email");
	io.writeln(
		"  --use-adc                   Use Google Application Default Credentials",
	);
	io.writeln("");
	io.writeln("Environment:");
	io.writeln("  GOOGLE_CHAT_CREDENTIALS     Service account JSON");
	io.writeln(
		"  GOOGLE_CHAT_USE_ADC=true    Use Application Default Credentials",
	);
	io.writeln("  GOOGLE_CHAT_PUBSUB_TOPIC    Optional Pub/Sub topic");
	io.writeln("  GOOGLE_CHAT_IMPERSONATE_USER Optional delegation user");
}

function parseConnectGoogleChatArgs(
	connectArgs: string[],
): ConnectGoogleChatOptions {
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
			process.env.GOOGLE_CHAT_BOT_USERNAME?.trim() ||
			"cline-gchat",
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
		pubsubTopic:
			parseStringFlag(connectArgs, "", "--pubsub-topic") ||
			process.env.GOOGLE_CHAT_PUBSUB_TOPIC?.trim(),
		impersonateUser:
			parseStringFlag(connectArgs, "", "--impersonate-user") ||
			process.env.GOOGLE_CHAT_IMPERSONATE_USER?.trim(),
		useApplicationDefaultCredentials:
			parseBooleanFlag(connectArgs, "--use-adc") ||
			process.env.GOOGLE_CHAT_USE_ADC?.trim().toLowerCase() === "true",
		credentialsJson:
			parseStringFlag(connectArgs, "", "--credentials-json") ||
			process.env.GOOGLE_CHAT_CREDENTIALS?.trim(),
	};
}

async function buildGoogleChatStartRequest(
	options: ConnectGoogleChatOptions,
	io: ConnectIo,
	loggerConfig: Parameters<
		typeof buildConnectorStartRequest
	>[0]["loggerConfig"],
): Promise<RpcChatStartSessionRequest> {
	return buildConnectorStartRequest({
		options,
		io,
		loggerConfig,
		systemRules: GCHAT_SYSTEM_RULES,
		teamName: `gchat-${options.userName.replace(/[^a-zA-Z0-9_-]+/g, "-")}`,
	});
}

async function deliverScheduledResult(input: {
	bot: Chat;
	client: RpcSessionClient;
	logger: CliLoggerAdapter;
	bindingsPath: string;
	userName: string;
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
	if (!delivery || delivery.adapter !== "gchat") {
		return;
	}
	const targetUser =
		typeof delivery.userName === "string" ? delivery.userName.trim() : "";
	if (targetUser && targetUser !== input.userName) {
		return;
	}
	const threadId =
		typeof delivery.threadId === "string" ? delivery.threadId.trim() : "";
	if (!threadId) {
		return;
	}
	const binding = readBindings<GoogleChatThreadState>(input.bindingsPath)[
		threadId
	];
	if (!binding?.serializedThread) {
		return;
	}
	const thread = JSON.parse(
		binding.serializedThread,
		input.bot.reviver(),
	) as Thread<GoogleChatThreadState>;
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

async function runConnectGoogleChatCommand(
	rawArgs: string[],
	io: ConnectIo,
): Promise<number> {
	let options: ConnectGoogleChatOptions;
	try {
		options = parseConnectGoogleChatArgs(rawArgs);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === "__SHOW_HELP__") {
			showConnectGoogleChatHelp(io);
			return 0;
		}
		io.writeErr(message);
		return 1;
	}

	const statePath = resolveConnectorStatePath(options.userName);
	const bindingsPath = resolveBindingsPath(options.userName);
	const existingState = readConnectorState(statePath);
	if (existingState && !isProcessRunning(existingState.pid)) {
		removeConnectorState(statePath);
	}
	if (!options.interactive && process.env.CLINE_GCHAT_CONNECT_CHILD !== "1") {
		const runningState = readConnectorState(statePath);
		if (runningState && isProcessRunning(runningState.pid)) {
			io.writeln(
				`[gchat] connector already running pid=${runningState.pid} rpc=${runningState.rpcAddress} url=${runningState.baseUrl}`,
			);
			return 0;
		}
		const pid = spawnDetachedConnector(
			["connect", "gchat"],
			rawArgs,
			"CLINE_GCHAT_CONNECT_CHILD",
		);
		if (!pid) {
			io.writeErr("failed to launch Google Chat connector in background");
			return 1;
		}
		io.writeln(
			`[gchat] starting background connector pid=${pid} user=${options.userName}`,
		);
		io.writeln(
			"[gchat] use `clite connect gchat -i ...` to run in the foreground",
		);
		return 0;
	}

	const loggerAdapter = createCliLoggerAdapter({
		runtime: "cli",
		component: "gchat-connect",
	});
	const logger = createChatSdkLogger(loggerAdapter);
	const consoleLogger = new ConsoleLogger("info", "gchat-connect");
	let parsedCredentials:
		| { client_email: string; private_key: string; project_id?: string }
		| undefined;
	if (options.credentialsJson) {
		try {
			const parsed = JSON.parse(options.credentialsJson) as Record<
				string,
				unknown
			>;
			if (
				typeof parsed.client_email !== "string" ||
				typeof parsed.private_key !== "string"
			) {
				throw new Error(
					"credentials JSON must include string client_email and private_key fields",
				);
			}
			parsedCredentials = {
				client_email: parsed.client_email,
				private_key: parsed.private_key,
				project_id:
					typeof parsed.project_id === "string" ? parsed.project_id : undefined,
			};
		} catch (error) {
			io.writeErr(
				`invalid GOOGLE_CHAT_CREDENTIALS JSON: ${error instanceof Error ? error.message : String(error)}`,
			);
			return 1;
		}
	}
	const endpointUrl = `${options.baseUrl.replace(/\/$/, "")}/api/webhooks/gchat`;
	const gchat = createGoogleChatAdapter(
		parsedCredentials
			? {
					credentials: parsedCredentials,
					endpointUrl,
					pubsubTopic: options.pubsubTopic,
					impersonateUser: options.impersonateUser,
					logger: consoleLogger,
					userName: options.userName,
				}
			: options.useApplicationDefaultCredentials
				? {
						useApplicationDefaultCredentials: true as const,
						endpointUrl,
						pubsubTopic: options.pubsubTopic,
						impersonateUser: options.impersonateUser,
						logger: consoleLogger,
						userName: options.userName,
					}
				: {
						endpointUrl,
						pubsubTopic: options.pubsubTopic,
						impersonateUser: options.impersonateUser,
						logger: consoleLogger,
						userName: options.userName,
					},
	);
	const bot = new Chat({
		userName: options.userName,
		adapters: { gchat },
		state: new InMemoryStateAdapter(),
		logger,
		fallbackStreamingPlaceholderText: null,
		streamingUpdateIntervalMs: 500,
	}).registerSingleton();
	const threadQueues = new Map<string, Promise<void>>();
	const pendingApprovals = new Map<string, PendingConnectorApproval>();
	const startRequest = await buildGoogleChatStartRequest(options, io, {
		enabled: loggerAdapter.runtimeConfig.enabled,
		level: loggerAdapter.runtimeConfig.level,
		destination: loggerAdapter.runtimeConfig.destination,
		bindings: {
			transport: "gchat",
			userName: options.userName,
		},
	});
	const rpcAddress = await ensureRpcRuntimeAddress(options.rpcAddress);
	process.env.CLINE_RPC_ADDRESS = rpcAddress;

	const clientId = `gchat-${process.pid}-${Date.now()}`;
	await registerRpcClient(rpcAddress, {
		clientId,
		clientType: "cli",
		metadata: {
			transport: "gchat",
			userName: options.userName,
		},
	}).catch(() => undefined);

	const client = new RpcSessionClient({ address: rpcAddress });
	writeConnectorState(statePath, {
		userName: options.userName,
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
		thread: Thread<GoogleChatThreadState>,
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
					transport: "gchat",
					botUserName: options.userName,
					requestStop,
					bindingsPath,
					hookCommand: options.hookCommand,
					systemRules: GCHAT_SYSTEM_RULES,
					errorLabel: "Google Chat",
					getSessionMetadata: (currentThread) => ({
						userName: options.userName,
						gchatThreadId: currentThread.id,
						gchatChannelId: currentThread.channelId,
					}),
					reusedLogMessage: "Google Chat thread reusing RPC session",
					onReplyCompleted: async (result) => {
						await dispatchConnectorHook(
							options.hookCommand,
							{
								adapter: "gchat",
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
								adapter: "gchat",
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
				await thread.post(`Google Chat bridge error: ${message}`);
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
				deniedReason: "Denied by Google Chat user",
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
				deniedReason: "Denied by Google Chat user",
			})
		) {
			return;
		}
		await handleTurn(thread, message.text);
	});

	await bot.initialize();
	const stopTaskUpdateStream =
		startConnectorTaskUpdateRelay<GoogleChatThreadState>({
			client,
			clientId,
			bot,
			logger: loggerAdapter,
			bindingsPath,
			transport: "gchat",
		});

	const server = await startConnectorWebhookServer({
		host: options.host,
		port: options.port,
		routes: {
			"/api/webhooks/gchat": async (request) => bot.webhooks.gchat(request),
			"/health": () => new Response("ok"),
			"/": () =>
				new Response(
					[
						"Google Chat connector is running.",
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
					userName: options.userName,
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

	io.writeln(`[gchat] listening on ${options.host}:${options.port}`);
	io.writeln(`[gchat] configure Google Chat App URL: ${endpointUrl}`);

	await stopPromise;
	stopTaskUpdateStream();
	stopEventStream();
	await server.close();
	client.close();
	removeConnectorState(statePath);
	return 0;
}

async function stopAllGoogleChatConnectors(
	io: ConnectIo,
): Promise<ConnectStopResult> {
	let stoppedProcesses = 0;
	let stoppedSessions = 0;
	for (const statePath of listConnectorStatePaths()) {
		const result = await stopGoogleChatConnectorInstance(statePath, io);
		stoppedProcesses += result.stoppedProcesses;
		stoppedSessions += result.stoppedSessions;
	}
	return { stoppedProcesses, stoppedSessions };
}

export const gchatConnector: ConnectCommandDefinition = {
	name: "gchat",
	description: "Google Chat webhook bridge backed by RPC runtime sessions",
	run: runConnectGoogleChatCommand,
	showHelp: showConnectGoogleChatHelp,
	stopAll: stopAllGoogleChatConnectors,
};

export const __test__ = {
	findBindingForThread: (
		bindings: ConnectorBindingStore<GoogleChatThreadState>,
		thread: Pick<Thread<GoogleChatThreadState>, "id" | "channelId" | "isDM">,
	) => findBindingForThread(bindings, thread),
};
