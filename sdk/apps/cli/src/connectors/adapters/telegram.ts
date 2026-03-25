import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import type { RpcChatStartSessionRequest } from "@clinebot/core";
import { resolveClineDataDir } from "@clinebot/core";
import { RpcSessionClient, registerRpcClient } from "@clinebot/rpc";
import { Chat, ConsoleLogger, type Thread } from "chat";
import { ensureRpcRuntimeAddress } from "../../commands/rpc";
import type { CliLoggerAdapter } from "../../logging/adapter";
import { createCliLoggerAdapter } from "../../logging/adapter";
import { createChatSdkLogger, enqueueThreadTurn } from "../chat-runtime";
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

const TELEGRAM_SYSTEM_RULES = [
	"Keep answers compact and optimized for a chat app unless the user asks for detail.",
	"Prefer short paragraphs and concise lists suitable for Telegram.",
	"When tools are disabled, explain limits briefly and ask for /tools if tool usage is required.",
].join("\n");

type TelegramThreadState = ConnectorThreadState;

type ConnectTelegramOptions = {
	botToken: string;
	botUsername: string;
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
};

type TelegramConnectorState = {
	botUsername: string;
	pid: number;
	rpcAddress: string;
	startedAt: string;
};

function truncateText(value: string, maxLength = 160): string {
	return truncateConnectorText(value, maxLength);
}

function sanitizeKey(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function resolveConnectorStatePath(botUsername: string): string {
	return join(
		resolveClineDataDir(),
		"connectors",
		"telegram",
		`${sanitizeKey(botUsername)}.json`,
	);
}

function resolveBindingsPath(botUsername: string): string {
	return join(
		resolveClineDataDir(),
		"connectors",
		"telegram",
		`${sanitizeKey(botUsername)}.threads.json`,
	);
}

function listConnectorStatePaths(): string[] {
	const dir = join(resolveClineDataDir(), "connectors", "telegram");
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json") && !name.endsWith(".threads.json"))
		.map((name) => join(dir, name));
}

function readConnectorState(
	statePath: string,
): TelegramConnectorState | undefined {
	const parsed = readJsonFile<TelegramConnectorState | undefined>(
		statePath,
		undefined,
	);
	if (
		!parsed ||
		typeof parsed !== "object" ||
		typeof parsed.pid !== "number" ||
		typeof parsed.botUsername !== "string"
	) {
		return undefined;
	}
	return parsed;
}

function writeConnectorState(
	statePath: string,
	state: TelegramConnectorState,
): void {
	writeJsonFile(statePath, state);
}

function removeConnectorState(statePath: string): void {
	removeFile(statePath);
}

async function stopSessionsForBot(
	state: TelegramConnectorState,
): Promise<number> {
	return stopConnectorSessions({
		rpcAddress: state.rpcAddress,
		rpcMatcher: (metadata) =>
			metadata?.transport === "telegram" &&
			metadata?.botUserName === state.botUsername,
		localMatcher: (metadata) =>
			metadata?.transport === "telegram" &&
			metadata?.botUserName === state.botUsername,
	});
}

async function stopTelegramConnectorInstance(
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
		io.writeln(`[telegram] stopped pid=${state.pid} bot=@${state.botUsername}`);
	}
	const stoppedSessions = await stopSessionsForBot(state);
	clearBindingSessionIds<TelegramThreadState>(
		resolveBindingsPath(state.botUsername),
	);
	removeConnectorState(statePath);
	return { stoppedProcesses, stoppedSessions };
}

function showConnectTelegramHelp(io: ConnectIo): void {
	io.writeln("Usage:");
	io.writeln(
		"  clite connect telegram -m <TELEGRAM_BOT_USERNAME> -k <TELEGRAM_BOT_TOKEN>",
	);
	io.writeln("");
	io.writeln("Options:");
	io.writeln("  -m, --bot-username <name>   Telegram bot username");
	io.writeln("  -k, --bot-token <token>     Telegram bot token");
	io.writeln("  --provider <id>             Provider override");
	io.writeln("  --model <id>                Model override");
	io.writeln("  --api-key <key>             Provider API key override");
	io.writeln("  --system <prompt>           System prompt override");
	io.writeln("  --cwd <path>                Workspace / cwd for runtime");
	io.writeln("  --mode <act|plan>           Agent mode (default: act)");
	io.writeln("  -i, --interactive           Keep connector in foreground");
	io.writeln("  --max-iterations <n>        Optional max iterations");
	io.writeln(
		"  --enable-tools              Enable tools for Telegram sessions",
	);
	io.writeln(
		"  --hook-command <command>    Run a shell command for connector events",
	);
	io.writeln(
		"  --rpc-address <host:port>   RPC address (default: 127.0.0.1:4317)",
	);
	io.writeln("");
	io.writeln("Notes:");
	io.writeln("  - Without -i, the connector is launched in the background.");
	io.writeln("  - Tools are disabled by default for Telegram sessions.");
	io.writeln(
		"  - Provider/model default to the CLI's last-used provider settings.",
	);
}

function parseConnectTelegramArgs(
	connectArgs: string[],
): ConnectTelegramOptions {
	if (
		parseBooleanFlag(connectArgs, "-h") ||
		parseBooleanFlag(connectArgs, "--help")
	) {
		throw new Error("__SHOW_HELP__");
	}

	const botUsername =
		parseStringFlag(connectArgs, "-m", "--bot-username") ||
		process.env.TELEGRAM_BOT_USERNAME?.trim();
	const botToken =
		parseStringFlag(connectArgs, "-k", "--bot-token") ||
		process.env.TELEGRAM_BOT_TOKEN?.trim();
	if (!botUsername) {
		throw new Error("connect telegram requires -m/--bot-username <name>");
	}
	if (!botToken) {
		throw new Error("connect telegram requires -k/--bot-token <token>");
	}

	const modeRaw =
		parseStringFlag(connectArgs, "", "--mode")?.toLowerCase() || "act";
	if (modeRaw !== "act" && modeRaw !== "plan") {
		throw new Error(`invalid mode "${modeRaw}" (expected "act" or "plan")`);
	}

	return {
		botToken,
		botUsername,
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
	};
}

async function buildTelegramStartRequest(
	options: ConnectTelegramOptions,
	io: ConnectIo,
	loggerConfig: Parameters<
		typeof buildConnectorStartRequest
	>[0]["loggerConfig"],
): Promise<RpcChatStartSessionRequest> {
	return buildConnectorStartRequest({
		options,
		io,
		loggerConfig,
		systemRules: TELEGRAM_SYSTEM_RULES,
		teamName: `telegram-${options.botUsername.replace(/[^a-zA-Z0-9_-]+/g, "-")}`,
	});
}

async function deliverScheduledResult(input: {
	bot: Chat;
	client: RpcSessionClient;
	logger: CliLoggerAdapter;
	bindingsPath: string;
	botUsername: string;
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
	if (!delivery || delivery.adapter !== "telegram") {
		return;
	}
	const targetBot =
		typeof delivery.botUserName === "string" ? delivery.botUserName.trim() : "";
	if (targetBot && targetBot !== input.botUsername) {
		return;
	}
	const threadId =
		typeof delivery.threadId === "string" ? delivery.threadId.trim() : "";
	if (!threadId) {
		return;
	}
	const binding = readBindings<TelegramThreadState>(input.bindingsPath)[
		threadId
	];
	if (!binding?.serializedThread) {
		input.logger.core.warn?.(
			"Scheduled Telegram delivery skipped: missing thread binding",
			{
				transport: "telegram",
				scheduleId: input.scheduleId,
				executionId: input.executionId,
				threadId,
			},
		);
		return;
	}
	await dispatchConnectorHook(
		input.hookCommand,
		{
			adapter: "telegram",
			botUserName: input.botUsername,
			event: "schedule.delivery.started",
			payload: {
				threadId,
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
	) as Thread<TelegramThreadState>;
	let body = "";
	if (input.status === "success" && input.sessionId) {
		const text = await readSessionReplyText(input.client, input.sessionId);
		body = text?.trim()
			? text
			: `Schedule "${schedule?.name ?? input.scheduleId}" completed, but no assistant reply text was found.`;
	} else {
		body = `Schedule "${schedule?.name ?? input.scheduleId}" ${input.status}.${input.errorMessage ? `\n\n${input.errorMessage}` : ""}`;
	}
	try {
		await thread.post(body);
		input.logger.core.info?.("Scheduled Telegram delivery sent", {
			transport: "telegram",
			threadId,
			scheduleId: input.scheduleId,
			executionId: input.executionId,
			status: input.status,
			outputPreview: truncateText(body),
		});
		await dispatchConnectorHook(
			input.hookCommand,
			{
				adapter: "telegram",
				botUserName: input.botUsername,
				event: "schedule.delivery.sent",
				payload: {
					threadId,
					scheduleId: input.scheduleId,
					executionId: input.executionId,
					status: input.status,
					outputPreview: truncateText(body),
				},
				ts: new Date().toISOString(),
			},
			input.logger,
		);
	} catch (error) {
		input.logger.core.error?.("Scheduled Telegram delivery failed", {
			transport: "telegram",
			threadId,
			scheduleId: input.scheduleId,
			executionId: input.executionId,
			error,
		});
		await dispatchConnectorHook(
			input.hookCommand,
			{
				adapter: "telegram",
				botUserName: input.botUsername,
				event: "schedule.delivery.failed",
				payload: {
					threadId,
					scheduleId: input.scheduleId,
					executionId: input.executionId,
					error: error instanceof Error ? error.message : String(error),
				},
				ts: new Date().toISOString(),
			},
			input.logger,
		);
	}
}

async function runConnectTelegramCommand(
	rawArgs: string[],
	io: ConnectIo,
): Promise<number> {
	let options: ConnectTelegramOptions;
	try {
		options = parseConnectTelegramArgs(rawArgs);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === "__SHOW_HELP__") {
			showConnectTelegramHelp(io);
			return 0;
		}
		io.writeErr(message);
		return 1;
	}

	const statePath = resolveConnectorStatePath(options.botUsername);
	const bindingsPath = resolveBindingsPath(options.botUsername);
	const existingState = readConnectorState(statePath);
	if (existingState && !isProcessRunning(existingState.pid)) {
		removeConnectorState(statePath);
	}
	if (
		!options.interactive &&
		process.env.CLINE_TELEGRAM_CONNECT_CHILD !== "1"
	) {
		const runningState = readConnectorState(statePath);
		if (runningState && isProcessRunning(runningState.pid)) {
			io.writeln(
				`[telegram] connector already running pid=${runningState.pid} rpc=${runningState.rpcAddress}`,
			);
			return 0;
		}
		const pid = spawnDetachedConnector(
			["connect", "telegram"],
			rawArgs,
			"CLINE_TELEGRAM_CONNECT_CHILD",
		);
		if (!pid) {
			io.writeErr("failed to launch Telegram connector in background");
			return 1;
		}
		io.writeln(
			`[telegram] starting background connector pid=${pid} bot=@${options.botUsername}`,
		);
		io.writeln(
			"[telegram] use `clite connect telegram -i ...` to run in the foreground",
		);
		return 0;
	}

	const loggerAdapter = createCliLoggerAdapter({
		runtime: "cli",
		component: "telegram-connect",
	});
	const logger = createChatSdkLogger(loggerAdapter);
	const consoleLogger = new ConsoleLogger("info", "telegram-connect");
	const telegram = createTelegramAdapter({
		mode: "polling",
		botToken: options.botToken,
		userName: options.botUsername,
		logger,
	});
	const bot = new Chat({
		userName: options.botUsername,
		adapters: { telegram },
		state: new InMemoryStateAdapter(),
		logger,
		fallbackStreamingPlaceholderText: null,
		streamingUpdateIntervalMs: 500,
	}).registerSingleton();
	const threadQueues = new Map<string, Promise<void>>();
	const pendingApprovals = new Map<string, PendingConnectorApproval>();
	const startRequest = await buildTelegramStartRequest(options, io, {
		enabled: loggerAdapter.runtimeConfig.enabled,
		level: loggerAdapter.runtimeConfig.level,
		destination: loggerAdapter.runtimeConfig.destination,
		bindings: {
			transport: "telegram",
			botUserName: options.botUsername,
		},
	});
	const rpcAddress = await ensureRpcRuntimeAddress(options.rpcAddress);
	process.env.CLINE_RPC_ADDRESS = rpcAddress;

	const clientId = `telegram-${process.pid}-${Date.now()}`;
	await registerRpcClient(rpcAddress, {
		clientId,
		clientType: "cli",
		metadata: {
			transport: "telegram",
			botUserName: options.botUsername,
		},
	}).catch(() => undefined);

	const client = new RpcSessionClient({ address: rpcAddress });
	writeConnectorState(statePath, {
		botUsername: options.botUsername,
		pid: process.pid,
		rpcAddress,
		startedAt: new Date().toISOString(),
	});
	loggerAdapter.core.info?.("Telegram connector started", {
		transport: "telegram",
		botUserName: options.botUsername,
		pid: process.pid,
		rpcAddress,
		mode: telegram.runtimeMode,
		interactive: options.interactive,
	});
	await dispatchConnectorHook(
		options.hookCommand,
		{
			adapter: "telegram",
			botUserName: options.botUsername,
			event: "connector.started",
			payload: {
				pid: process.pid,
				rpcAddress,
				mode: telegram.runtimeMode,
			},
			ts: new Date().toISOString(),
		},
		loggerAdapter,
	);

	let stopping = false;
	let resolveStop: (() => void) | undefined;
	const stopPromise = new Promise<void>((resolve) => {
		resolveStop = resolve;
	});
	const requestStop = (reason: string) => {
		if (stopping) {
			return;
		}
		stopping = true;
		loggerAdapter.core.warn?.("Telegram connector stopping", {
			transport: "telegram",
			reason,
			pid: process.pid,
		});
		resolveStop?.();
	};

	const handleTurn = async (
		thread: Thread<TelegramThreadState>,
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
					transport: "telegram",
					botUserName: options.botUsername,
					requestStop,
					bindingsPath,
					hookCommand: options.hookCommand,
					systemRules: TELEGRAM_SYSTEM_RULES,
					errorLabel: "Telegram",
					getSessionMetadata: (currentThread) => ({
						botUserName: options.botUsername,
						telegramThreadId: currentThread.id,
						telegramChannelId: currentThread.channelId,
					}),
					reusedLogMessage: "Telegram thread reusing RPC session",
					startedLogMessage: "Telegram thread started RPC session",
					messageReceivedLogMessage: "Telegram message received",
					threadResetLogMessage: "Telegram thread reset",
					connectorStopLogMessage:
						"Telegram connector stop requested from chat",
					onMessageReceived: async (details) => {
						await dispatchConnectorHook(
							options.hookCommand,
							{
								adapter: "telegram",
								botUserName: options.botUsername,
								event: "message.received",
								payload: details,
								ts: new Date().toISOString(),
							},
							loggerAdapter,
						);
					},
					onReplyCompleted: async (result) => {
						loggerAdapter.core.info?.("Telegram reply completed", {
							transport: "telegram",
							threadId: result.threadId,
							sessionId: result.sessionId,
							outputLength: result.text.length,
							outputPreview: truncateText(result.text),
							finishReason: result.finishReason,
							iterations: result.iterations,
						});
						await dispatchConnectorHook(
							options.hookCommand,
							{
								adapter: "telegram",
								botUserName: options.botUsername,
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
						loggerAdapter.core.error?.("Telegram reply failed", {
							transport: "telegram",
							threadId: details.threadId,
							sessionId: details.sessionId,
							error: details.error,
						});
						await dispatchConnectorHook(
							options.hookCommand,
							{
								adapter: "telegram",
								botUserName: options.botUsername,
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
				loggerAdapter.core.error?.("Telegram turn handling failed", {
					transport: "telegram",
					threadId: thread.id,
					error,
				});
				await thread.post(`Telegram bridge error: ${message}`);
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
				deniedReason: "Denied by Telegram user",
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
				deniedReason: "Denied by Telegram user",
			})
		) {
			return;
		}
		await handleTurn(thread, message.text);
	});

	await bot.initialize();
	const stopTaskUpdateStream =
		startConnectorTaskUpdateRelay<TelegramThreadState>({
			client,
			clientId,
			bot,
			logger: loggerAdapter,
			bindingsPath,
			transport: "telegram",
		});

	const stopEventStream = client.streamEvents(
		{ clientId: `${clientId}-server-events` },
		{
			onEvent: (event) => {
				if (event.eventType === "rpc.server.shutting_down") {
					loggerAdapter.core.warn?.(
						"Telegram connector stopping because the RPC server is shutting down",
						{
							transport: "telegram",
							eventType: event.eventType,
						},
					);
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
					botUsername: options.botUsername,
					scheduleId,
					executionId,
					sessionId,
					status,
					errorMessage,
					hookCommand: options.hookCommand,
				});
			},
			onError: (error) => {
				loggerAdapter.core.warn?.(
					"Telegram connector server event stream failed",
					{
						transport: "telegram",
						error,
					},
				);
				requestStop("rpc_server_event_stream_failed");
			},
		},
	);

	consoleLogger.info("Telegram connector ready", {
		rpcAddress,
		mode: telegram.runtimeMode,
	});
	io.writeln(
		`[telegram] connected as @${options.botUsername} mode=${telegram.runtimeMode} rpc=${rpcAddress} provider=${startRequest.provider} model=${startRequest.model} tools=${startRequest.enableTools ? "on" : "off"}`,
	);
	io.writeln("[telegram] send /reset in a chat to start a fresh RPC session");
	io.writeln(
		"[telegram] send /whereami in a chat to get its delivery thread id",
	);
	io.writeln(
		"[telegram] use /tools, /yolo, or /cwd <path> to update runtime settings",
	);
	io.writeln("[telegram] send /stop in a chat or press Ctrl+C to stop");

	const shutdown = () => {
		process.off("SIGINT", shutdown);
		process.off("SIGTERM", shutdown);
		requestStop("signal");
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	await stopPromise;

	stopTaskUpdateStream();
	stopEventStream();
	await dispatchConnectorHook(
		options.hookCommand,
		{
			adapter: "telegram",
			botUserName: options.botUsername,
			event: "connector.stopping",
			payload: { pid: process.pid },
			ts: new Date().toISOString(),
		},
		loggerAdapter,
	);
	await telegram.stopPolling().catch(() => undefined);
	await bot.shutdown().catch(() => undefined);
	client.close();
	removeConnectorState(statePath);
	loggerAdapter.core.info?.("Telegram connector stopped", {
		transport: "telegram",
		pid: process.pid,
	});
	return 0;
}

export const telegramConnector: ConnectCommandDefinition = {
	name: "telegram",
	description: "Bridge Telegram bot messages into RPC chat sessions",
	run: runConnectTelegramCommand,
	showHelp: showConnectTelegramHelp,
	stopAll: async (io) => {
		const statePaths = listConnectorStatePaths();
		let stoppedProcesses = 0;
		let stoppedSessions = 0;
		for (const statePath of statePaths) {
			const result = await stopTelegramConnectorInstance(statePath, io);
			stoppedProcesses += result.stoppedProcesses;
			stoppedSessions += result.stoppedSessions;
		}
		return { stoppedProcesses, stoppedSessions };
	},
};

export const __test__ = {
	findBindingForThread: (
		bindings: ConnectorBindingStore<TelegramThreadState>,
		thread: Pick<Thread<TelegramThreadState>, "id" | "channelId" | "isDM">,
	) => findBindingForThread(bindings, thread),
};
