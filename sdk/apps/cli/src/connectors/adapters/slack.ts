import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import type { RpcChatStartSessionRequest } from "@clinebot/core";
import { resolveClineDataDir } from "@clinebot/core";
import { RpcSessionClient, registerRpcClient } from "@clinebot/rpc";
import { type Adapter, Chat, ConsoleLogger, type Thread } from "chat";
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
import { FileStateAdapter } from "../stores/file-state";
import { startConnectorTaskUpdateRelay } from "../task-updates";
import {
	type ConnectorBindingStore,
	type ConnectorThreadBinding,
	type ConnectorThreadState,
	clearBindingSessionIds,
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

const SLACK_SYSTEM_RULES = [
	"You are a helpful coding assistant that works in a VM while intergrated with Slack.",
	"You can respond to user messages in threads and DMs, and you can use tools according to user's requests and your capabilities.",
	"Keep answers compact and optimized for Slack unless the user asks for detail.",
	"Use short paragraphs and concise lists that read cleanly in channel threads and DMs.",
].join("\n");

type SlackThreadState = ConnectorThreadState & {
	teamId?: string;
};

type ConnectSlackOptions = {
	userName: string;
	botToken?: string;
	signingSecret?: string;
	clientId?: string;
	clientSecret?: string;
	encryptionKey?: string;
	installationKeyPrefix?: string;
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

type SlackConnectorState = {
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
		"slack",
		`${sanitizeKey(userName)}.json`,
	);
}

function resolveBindingsPath(userName: string): string {
	return join(
		resolveClineDataDir(),
		"connectors",
		"slack",
		`${sanitizeKey(userName)}.threads.json`,
	);
}

function resolveStateStorePath(userName: string): string {
	return join(
		resolveClineDataDir(),
		"connectors",
		"slack",
		`${sanitizeKey(userName)}.state.json`,
	);
}

function listConnectorStatePaths(): string[] {
	const dir = join(resolveClineDataDir(), "connectors", "slack");
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir)
		.filter(
			(name) =>
				name.endsWith(".json") &&
				!name.endsWith(".threads.json") &&
				!name.endsWith(".state.json"),
		)
		.map((name) => join(dir, name));
}

function readConnectorState(
	statePath: string,
): SlackConnectorState | undefined {
	const parsed = readJsonFile<SlackConnectorState | undefined>(
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
	state: SlackConnectorState,
): void {
	writeJsonFile(statePath, state);
}

function removeConnectorState(statePath: string): void {
	removeFile(statePath);
}

async function stopSessionsForUser(
	state: SlackConnectorState,
): Promise<number> {
	return stopConnectorSessions({
		rpcAddress: state.rpcAddress,
		rpcMatcher: (metadata) =>
			metadata?.transport === "slack" && metadata?.userName === state.userName,
		localMatcher: (metadata) =>
			metadata?.transport === "slack" && metadata?.userName === state.userName,
	});
}

async function stopSlackConnectorInstance(
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
		io.writeln(`[slack] stopped pid=${state.pid} user=${state.userName}`);
	}
	const stoppedSessions = await stopSessionsForUser(state);
	clearBindingSessionIds<SlackThreadState>(resolveBindingsPath(state.userName));
	removeConnectorState(statePath);
	return { stoppedProcesses, stoppedSessions };
}

function showConnectSlackHelp(io: ConnectIo): void {
	io.writeln("Usage:");
	io.writeln("  clite connect slack --base-url <PUBLIC_BASE_URL> [options]");
	io.writeln("");
	io.writeln("Options:");
	io.writeln("  --user-name <name>          Slack bot username label");
	io.writeln(
		"  --bot-token <token>         Slack bot token for single-workspace mode",
	);
	io.writeln("  --signing-secret <secret>   Slack signing secret");
	io.writeln("  --client-id <id>            Slack OAuth client id");
	io.writeln("  --client-secret <secret>    Slack OAuth client secret");
	io.writeln(
		"  --encryption-key <key>      Base64 32-byte key for encrypted installations",
	);
	io.writeln(
		"  --installation-key-prefix <prefix> Override stored installation key prefix",
	);
	io.writeln("  --provider <id>             Provider override");
	io.writeln("  --model <id>                Model override");
	io.writeln("  --api-key <key>             Provider API key override");
	io.writeln("  --system <prompt>           System prompt override");
	io.writeln("  --cwd <path>                Workspace / cwd for runtime");
	io.writeln("  --mode <act|plan>           Agent mode (default: act)");
	io.writeln("  -i, --interactive           Keep connector in foreground");
	io.writeln("  --max-iterations <n>        Optional max iterations");
	io.writeln("  --enable-tools              Enable tools for Slack sessions");
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
		"  --base-url <url>            Public base URL for webhooks and OAuth callback",
	);
	io.writeln("");
	io.writeln("Environment:");
	io.writeln("  SLACK_BOT_TOKEN             Single-workspace bot token");
	io.writeln("  SLACK_SIGNING_SECRET        Slack signing secret");
	io.writeln("  SLACK_CLIENT_ID             OAuth client id");
	io.writeln("  SLACK_CLIENT_SECRET         OAuth client secret");
	io.writeln(
		"  SLACK_ENCRYPTION_KEY        Optional installation encryption key",
	);
}

function parseConnectSlackArgs(connectArgs: string[]): ConnectSlackOptions {
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
			process.env.SLACK_BOT_USERNAME?.trim() ||
			"cline-slack",
		botToken:
			parseStringFlag(connectArgs, "", "--bot-token") ||
			process.env.SLACK_BOT_TOKEN?.trim(),
		signingSecret:
			parseStringFlag(connectArgs, "", "--signing-secret") ||
			process.env.SLACK_SIGNING_SECRET?.trim(),
		clientId:
			parseStringFlag(connectArgs, "", "--client-id") ||
			process.env.SLACK_CLIENT_ID?.trim(),
		clientSecret:
			parseStringFlag(connectArgs, "", "--client-secret") ||
			process.env.SLACK_CLIENT_SECRET?.trim(),
		encryptionKey:
			parseStringFlag(connectArgs, "", "--encryption-key") ||
			process.env.SLACK_ENCRYPTION_KEY?.trim(),
		installationKeyPrefix:
			parseStringFlag(connectArgs, "", "--installation-key-prefix") ||
			process.env.SLACK_INSTALLATION_KEY_PREFIX?.trim(),
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

async function buildSlackStartRequest(
	options: ConnectSlackOptions,
	io: ConnectIo,
	loggerConfig: Parameters<
		typeof buildConnectorStartRequest
	>[0]["loggerConfig"],
): Promise<RpcChatStartSessionRequest> {
	return buildConnectorStartRequest({
		options,
		io,
		loggerConfig,
		systemRules: SLACK_SYSTEM_RULES,
		teamName: `slack-${options.userName.replace(/[^a-zA-Z0-9_-]+/g, "-")}`,
	});
}

function extractSlackTeamId(raw: unknown): string | undefined {
	if (!raw || typeof raw !== "object") {
		return undefined;
	}
	const record = raw as Record<string, unknown>;
	const value =
		typeof record.team_id === "string"
			? record.team_id
			: typeof record.team === "string"
				? record.team
				: undefined;
	return value?.trim() || undefined;
}

async function withSlackBindingBotToken<T>(input: {
	slack: SlackAdapter;
	binding: ConnectorThreadBinding<SlackThreadState>;
	work: () => Promise<T>;
}): Promise<T> {
	const teamId = input.binding.state?.teamId?.trim();
	if (!teamId) {
		return input.work();
	}
	const installation = await input.slack.getInstallation(teamId);
	if (!installation?.botToken) {
		return input.work();
	}
	return input.slack.withBotToken(installation.botToken, input.work);
}

async function persistSlackThreadContext(input: {
	thread: Thread<SlackThreadState>;
	bindingsPath: string;
	baseStartRequest: RpcChatStartSessionRequest;
	rawMessage: unknown;
	errorLabel: string;
}): Promise<void> {
	const teamId = extractSlackTeamId(input.rawMessage);
	if (!teamId) {
		return;
	}
	const currentState = await loadThreadState(
		input.thread,
		input.bindingsPath,
		input.baseStartRequest,
	);
	if (currentState.teamId === teamId) {
		return;
	}
	await persistMergedThreadState(
		input.thread,
		input.bindingsPath,
		{
			...currentState,
			teamId,
		},
		input.errorLabel,
	);
}

async function deliverScheduledResult(input: {
	bot: Chat;
	slack: SlackAdapter;
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
	if (!delivery || delivery.adapter !== "slack") {
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
	const binding = readBindings<SlackThreadState>(input.bindingsPath)[threadId];
	if (!binding?.serializedThread) {
		return;
	}
	const thread = JSON.parse(
		binding.serializedThread,
		input.bot.reviver(),
	) as Thread<SlackThreadState>;
	let body = "";
	if (input.status === "success" && input.sessionId) {
		const text = await readSessionReplyText(input.client, input.sessionId);
		body = text?.trim()
			? text
			: `Schedule "${schedule?.name ?? input.scheduleId}" completed, but no assistant reply text was found.`;
	} else {
		body = `Schedule "${schedule?.name ?? input.scheduleId}" ${input.status}.${input.errorMessage ? `\n\n${input.errorMessage}` : ""}`;
	}
	await withSlackBindingBotToken({
		slack: input.slack,
		binding,
		work: () => thread.post(body).then(() => undefined),
	});
}

async function runConnectSlackCommand(
	rawArgs: string[],
	io: ConnectIo,
): Promise<number> {
	let options: ConnectSlackOptions;
	try {
		options = parseConnectSlackArgs(rawArgs);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === "__SHOW_HELP__") {
			showConnectSlackHelp(io);
			return 0;
		}
		io.writeErr(message);
		return 1;
	}

	const statePath = resolveConnectorStatePath(options.userName);
	const bindingsPath = resolveBindingsPath(options.userName);
	const stateStorePath = resolveStateStorePath(options.userName);
	const existingState = readConnectorState(statePath);
	if (existingState && !isProcessRunning(existingState.pid)) {
		removeConnectorState(statePath);
	}
	if (!options.interactive && process.env.CLINE_SLACK_CONNECT_CHILD !== "1") {
		const runningState = readConnectorState(statePath);
		if (runningState && isProcessRunning(runningState.pid)) {
			io.writeln(
				`[slack] connector already running pid=${runningState.pid} rpc=${runningState.rpcAddress} url=${runningState.baseUrl}`,
			);
			return 0;
		}
		const pid = spawnDetachedConnector(
			["connect", "slack"],
			rawArgs,
			"CLINE_SLACK_CONNECT_CHILD",
		);
		if (!pid) {
			io.writeErr("failed to launch Slack connector in background");
			return 1;
		}
		io.writeln(
			`[slack] starting background connector pid=${pid} user=${options.userName}`,
		);
		io.writeln(
			"[slack] use `clite connect slack -i ...` to run in the foreground",
		);
		return 0;
	}

	const loggerAdapter = createCliLoggerAdapter({
		runtime: "cli",
		component: "slack-connect",
	});
	const logger = createChatSdkLogger(loggerAdapter);
	const consoleLogger = new ConsoleLogger("info", "slack-connect");
	const slackConfig: Record<string, unknown> = {
		logger: consoleLogger,
		userName: options.userName,
	};
	if (options.botToken?.trim()) {
		slackConfig.botToken = options.botToken.trim();
	}
	if (options.signingSecret?.trim()) {
		slackConfig.signingSecret = options.signingSecret.trim();
	}
	if (options.clientId?.trim()) {
		slackConfig.clientId = options.clientId.trim();
	}
	if (options.clientSecret?.trim()) {
		slackConfig.clientSecret = options.clientSecret.trim();
	}
	if (options.encryptionKey?.trim()) {
		slackConfig.encryptionKey = options.encryptionKey.trim();
	}
	if (options.installationKeyPrefix?.trim()) {
		slackConfig.installationKeyPrefix = options.installationKeyPrefix.trim();
	}
	const slack = createSlackAdapter(slackConfig) as SlackAdapter;
	const bot = new Chat({
		userName: options.userName,
		adapters: { slack: slack as unknown as Adapter },
		state: new FileStateAdapter(stateStorePath),
		logger,
		fallbackStreamingPlaceholderText: null,
		streamingUpdateIntervalMs: 500,
	}).registerSingleton();
	const threadQueues = new Map<string, Promise<void>>();
	const pendingApprovals = new Map<string, PendingConnectorApproval>();
	const startRequest = await buildSlackStartRequest(options, io, {
		enabled: loggerAdapter.runtimeConfig.enabled,
		level: loggerAdapter.runtimeConfig.level,
		destination: loggerAdapter.runtimeConfig.destination,
		bindings: {
			transport: "slack",
			userName: options.userName,
		},
	});
	const rpcAddress = await ensureRpcRuntimeAddress(options.rpcAddress);
	process.env.CLINE_RPC_ADDRESS = rpcAddress;

	const clientId = `slack-${process.pid}-${Date.now()}`;
	await registerRpcClient(rpcAddress, {
		clientId,
		clientType: "cli",
		metadata: {
			transport: "slack",
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

	const handleTurn = async (thread: Thread<SlackThreadState>, text: string) => {
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
					transport: "slack",
					botUserName: options.userName,
					requestStop,
					bindingsPath,
					hookCommand: options.hookCommand,
					systemRules: SLACK_SYSTEM_RULES,
					errorLabel: "Slack",
					getSessionMetadata: (currentThread) => ({
						userName: options.userName,
						slackThreadId: currentThread.id,
						slackChannelId: currentThread.channelId,
					}),
					reusedLogMessage: "Slack thread reusing RPC session",
					startedLogMessage: "Slack thread started RPC session",
					onMessageReceived: async (details) => {
						await dispatchConnectorHook(
							options.hookCommand,
							{
								adapter: "slack",
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
								adapter: "slack",
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
								adapter: "slack",
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
				await thread.post(`Slack bridge error: ${message}`);
			}
		});
	};

	bot.onNewMention(async (thread, message) => {
		await thread.subscribe();
		await persistSlackThreadContext({
			thread,
			bindingsPath,
			baseStartRequest: startRequest,
			rawMessage: message.raw,
			errorLabel: "Slack",
		});
		if (
			await maybeHandleConnectorApprovalReply({
				thread,
				text: message.text,
				client,
				clientId,
				pendingApprovals,
				deniedReason: "Denied by Slack user",
			})
		) {
			return;
		}
		await handleTurn(thread, message.text);
	});

	bot.onSubscribedMessage(async (thread, message) => {
		await persistSlackThreadContext({
			thread,
			bindingsPath,
			baseStartRequest: startRequest,
			rawMessage: message.raw,
			errorLabel: "Slack",
		});
		if (
			await maybeHandleConnectorApprovalReply({
				thread,
				text: message.text,
				client,
				clientId,
				pendingApprovals,
				deniedReason: "Denied by Slack user",
			})
		) {
			return;
		}
		await handleTurn(thread, message.text);
	});

	await bot.initialize();
	const stopTaskUpdateStream = startConnectorTaskUpdateRelay<SlackThreadState>({
		client,
		clientId,
		bot,
		logger: loggerAdapter,
		bindingsPath,
		transport: "slack",
		postToThread: async ({ thread, binding, body }) => {
			await withSlackBindingBotToken({
				slack,
				binding,
				work: () => thread.post(body).then(() => undefined),
			});
		},
	});

	const webhookUrl = `${options.baseUrl.replace(/\/$/, "")}/api/webhooks/slack`;
	const oauthCallbackUrl = `${options.baseUrl.replace(/\/$/, "")}/api/oauth/slack/callback`;
	const server = await startConnectorWebhookServer({
		host: options.host,
		port: options.port,
		routes: {
			"/api/webhooks/slack": async (request) => bot.webhooks.slack(request),
			"/api/oauth/slack/callback": async (request) => {
				try {
					const result = await slack.handleOAuthCallback(request);
					return new Response(
						`Slack installation stored for team ${result.teamId}. You can return to Slack.`,
					);
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					loggerAdapter.core.warn?.("Slack OAuth callback failed", {
						transport: "slack",
						error: message,
					});
					return new Response(`Slack OAuth error: ${message}`, {
						status: 500,
					});
				}
			},
			"/health": () => new Response("ok"),
			"/": () =>
				new Response(
					[
						"Slack connector is running.",
						`Webhook URL: ${webhookUrl}`,
						`OAuth callback URL: ${oauthCallbackUrl}`,
						options.botToken?.trim()
							? "Auth mode: single workspace"
							: options.clientId?.trim() && options.clientSecret?.trim()
								? "Auth mode: multi-workspace OAuth"
								: "Auth mode: incomplete (set bot token or OAuth credentials)",
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
					slack,
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

	io.writeln(`[slack] listening on ${options.host}:${options.port}`);
	io.writeln(`[slack] configure Slack webhook URL: ${webhookUrl}`);
	io.writeln(`[slack] configure Slack OAuth callback URL: ${oauthCallbackUrl}`);

	await stopPromise;
	stopTaskUpdateStream();
	stopEventStream();
	await server.close();
	client.close();
	removeConnectorState(statePath);
	return 0;
}

async function stopAllSlackConnectors(
	io: ConnectIo,
): Promise<ConnectStopResult> {
	let stoppedProcesses = 0;
	let stoppedSessions = 0;
	for (const statePath of listConnectorStatePaths()) {
		const result = await stopSlackConnectorInstance(statePath, io);
		stoppedProcesses += result.stoppedProcesses;
		stoppedSessions += result.stoppedSessions;
	}
	return { stoppedProcesses, stoppedSessions };
}

export const slackConnector: ConnectCommandDefinition = {
	name: "slack",
	description: "Slack webhook bridge backed by RPC runtime sessions",
	run: runConnectSlackCommand,
	showHelp: showConnectSlackHelp,
	stopAll: stopAllSlackConnectors,
};

export const __test__ = {
	findBindingForThread: (
		bindings: ConnectorBindingStore<SlackThreadState>,
		thread: Pick<Thread<SlackThreadState>, "id" | "channelId" | "isDM">,
	) => findBindingForThread(bindings, thread),
};
