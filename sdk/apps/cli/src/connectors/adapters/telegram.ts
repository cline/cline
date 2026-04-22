import { createTelegramAdapter } from "@chat-adapter/telegram";
import type { ChatStartSessionRequest } from "@clinebot/core";
import { createUserInstructionConfigWatcher } from "@clinebot/core";
import { HubSessionClient } from "@clinebot/hub";
import type {
	ConnectTelegramOptions,
	TelegramConnectorState,
} from "@clinebot/shared";
import { Chat, ConsoleLogger, type Thread } from "chat";
import type { Command } from "commander";
import type { CliLoggerAdapter } from "../../logging/adapter";
import { createCliLoggerAdapter } from "../../logging/adapter";
import {
	ensureCliHubServer,
	parseHubEndpointOverride,
} from "../../utils/hub-runtime";
import { createWorkspaceChatCommandHost } from "../../utils/plugin-chat-commands";
import { ConnectorBase } from "../base";
import { createChatSdkLogger, enqueueThreadTurn } from "../chat-runtime";
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

const TELEGRAM_SYSTEM_RULES = getConnectorSystemRules("Telegram");

const TELEGRAM_FIRST_CONTACT_MESSAGE = getConnectorFirstContactMessage();

type TelegramThreadState = ConnectorThreadState;

function truncateText(value: string, maxLength = 160): string {
	return truncateConnectorText(value, maxLength);
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

async function buildTelegramStartRequest(
	options: ConnectTelegramOptions,
	io: ConnectIo,
	loggerConfig: Parameters<
		typeof buildConnectorStartRequest
	>[0]["loggerConfig"],
): Promise<ChatStartSessionRequest> {
	return buildConnectorStartRequest({
		options,
		io,
		loggerConfig,
		systemRules: TELEGRAM_SYSTEM_RULES,
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

function readIdentifier(value: unknown): string | undefined {
	if (typeof value === "string" && value.trim()) {
		return value.trim();
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	return undefined;
}

function resolveTelegramParticipant(
	rawMessage: unknown,
): { key: string; label?: string } | undefined {
	const raw = asRecord(rawMessage);
	const message =
		asRecord(raw?.message) ??
		asRecord(raw?.edited_message) ??
		asRecord(raw?.channel_post) ??
		raw;
	const from = asRecord(message?.from);
	const username = readString(from?.username)?.toLowerCase();
	const userId = readIdentifier(from?.id);
	const firstName = readString(from?.first_name);
	const lastName = readString(from?.last_name);
	const label =
		username || [firstName, lastName].filter(Boolean).join(" ") || userId;
	if (username) {
		return { key: `telegram:user:${username}`, label };
	}
	if (userId) {
		return { key: `telegram:id:${userId}`, label };
	}
	return undefined;
}

async function persistTelegramThreadContext(input: {
	thread: Thread<TelegramThreadState>;
	bindingsPath: string;
	baseStartRequest: ChatStartSessionRequest;
	rawMessage: unknown;
	errorLabel: string;
}): Promise<void> {
	const participant = resolveTelegramParticipant(input.rawMessage);
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
		typeof delivery.userName === "string" ? delivery.userName.trim() : "";
	if (targetBot && targetBot !== input.botUsername) {
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
	const bindings = readBindings<TelegramThreadState>(input.bindingsPath);
	const match = bindingKey
		? findBindingForParticipantKey(bindings, bindingKey)
		: threadId
			? { key: threadId, binding: bindings[threadId] }
			: undefined;
	const binding = match?.binding;
	const deliveryThreadId = match?.key || threadId;
	if (!binding?.serializedThread) {
		input.logger.core.log(
			"Scheduled Telegram delivery skipped: missing thread binding",
			{
				severity: "warn",
				transport: "telegram",
				scheduleId: input.scheduleId,
				executionId: input.executionId,
				threadId: deliveryThreadId,
				bindingKey: bindingKey || undefined,
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
				threadId: deliveryThreadId,
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
		input.logger.core.log("Scheduled Telegram delivery sent", {
			transport: "telegram",
			threadId: deliveryThreadId,
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
					threadId: deliveryThreadId,
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
			threadId: deliveryThreadId,
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
					threadId: deliveryThreadId,
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

class TelegramConnector extends ConnectorBase<
	ConnectTelegramOptions,
	TelegramConnectorState
> {
	constructor() {
		super("telegram", "Bridge Telegram bot messages into RPC chat sessions");
	}

	protected override createCommand(): Command {
		return super
			.createCommand()
			.usage("-m <TELEGRAM_BOT_USERNAME> -k <TELEGRAM_BOT_TOKEN> [options]")
			.option("-m, --bot-username <name>", "Telegram bot username")
			.option("-k, --bot-token <token>", "Telegram bot token")
			.option("--provider <id>", "Provider override")
			.option("--model <id>", "Model override")
			.option("--api-key <key>", "Provider API key override")
			.option("--system <prompt>", "System prompt override")
			.option("--cwd <path>", "Workspace / cwd for runtime")
			.option("--mode <act|plan>", "Agent mode", "act")
			.option("-i, --interactive", "Keep connector in foreground")
			.option("--max-iterations <n>", "Optional max iterations")
			.option("--no-tools", "Disable tools for Telegram sessions")
			.option(
				"--hook-command <command>",
				"Run a shell command for connector events",
			)
			.option(
				"--rpc-address <host:port>",
				"RPC address",
				process.env.CLINE_RPC_ADDRESS?.trim() || "127.0.0.1:4317",
			)
			.addHelpText(
				"after",
				[
					"",
					"Notes:",
					"  - Without -i, the connector is launched in the background.",
					"  - Tools are enabled by default for Telegram sessions.",
					"  - Provider/model default to the CLI's last-used provider settings.",
				].join("\n"),
			);
	}

	protected override readOptions(command: Command): ConnectTelegramOptions {
		const opts = command.opts<{
			botUsername?: string;
			botToken?: string;
			cwd?: string;
			model?: string;
			provider?: string;
			apiKey?: string;
			system?: string;
			mode?: string;
			interactive?: boolean;
			maxIterations?: string;
			noTools?: boolean;
			rpcAddress?: string;
			hookCommand?: string;
		}>();
		const botUsername =
			opts.botUsername?.trim() || process.env.TELEGRAM_BOT_USERNAME?.trim();
		const botToken =
			opts.botToken?.trim() || process.env.TELEGRAM_BOT_TOKEN?.trim();
		if (!botUsername) {
			throw new Error("connect telegram requires -m/--bot-username <name>");
		}
		if (!botToken) {
			throw new Error("connect telegram requires -k/--bot-token <token>");
		}
		return {
			botToken,
			botUsername,
			cwd: opts.cwd || process.cwd(),
			model: opts.model,
			provider: opts.provider,
			apiKey: opts.apiKey,
			systemPrompt: opts.system,
			mode: this.parseMode(opts.mode),
			interactive: Boolean(opts.interactive),
			maxIterations: this.parseOptionalInteger(
				opts.maxIterations,
				"max iterations",
			),
			enableTools: opts.noTools !== true,
			rpcAddress:
				opts.rpcAddress?.trim() ||
				process.env.CLINE_RPC_ADDRESS?.trim() ||
				"127.0.0.1:4317",
			hookCommand:
				opts.hookCommand?.trim() ||
				process.env.CLINE_CONNECT_HOOK_COMMAND?.trim(),
		};
	}

	private resolveConnectorStatePath(botUsername: string): string {
		return this.resolveConnectorPath(`${this.sanitizeKey(botUsername)}.json`);
	}

	private resolveBindingsPath(botUsername: string): string {
		return this.resolveConnectorPath(
			`${this.sanitizeKey(botUsername)}.threads.json`,
		);
	}

	private listConnectorStatePaths(): string[] {
		return this.listJsonStatePaths([".threads.json"]);
	}

	private readConnectorState(
		statePath: string,
	): TelegramConnectorState | undefined {
		return this.readStateFile(
			statePath,
			(value): value is TelegramConnectorState =>
				Boolean(
					value &&
						typeof value === "object" &&
						typeof (value as TelegramConnectorState).pid === "number" &&
						typeof (value as TelegramConnectorState).botUsername === "string",
				),
		);
	}

	private writeConnectorState(
		statePath: string,
		state: TelegramConnectorState,
	): void {
		this.writeStateFile(statePath, state);
	}

	private async stopTelegramConnectorInstance(
		statePath: string,
		io: ConnectIo,
	): Promise<ConnectStopResult> {
		return this.stopManagedProcess({
			io,
			statePath,
			readState: (path) => this.readConnectorState(path),
			describeStoppedProcess: (state) =>
				`[telegram] stopped pid=${state.pid} bot=@${state.botUsername}`,
			getPid: (state) => state.pid,
			stopSessions: stopSessionsForBot,
			clearBindings: (state) => {
				clearBindingSessionIds<TelegramThreadState>(
					this.resolveBindingsPath(state.botUsername),
				);
			},
		});
	}

	override async stopAll(io: ConnectIo): Promise<ConnectStopResult> {
		return this.stopAllFromStatePaths(
			io,
			this.listConnectorStatePaths(),
			(statePath, stopIo) =>
				this.stopTelegramConnectorInstance(statePath, stopIo),
		);
	}

	protected override async runWithOptions(
		options: ConnectTelegramOptions,
		rawArgs: string[],
		io: ConnectIo,
	): Promise<number> {
		const statePath = this.resolveConnectorStatePath(options.botUsername);
		const bindingsPath = this.resolveBindingsPath(options.botUsername);
		this.removeStaleState(
			statePath,
			(path) => this.readConnectorState(path),
			(state) => state.pid,
		);
		if (
			await this.maybeRunInBackground({
				rawArgs,
				io,
				interactive: options.interactive,
				childEnvVar: "CLINE_TELEGRAM_CONNECT_CHILD",
				statePath,
				readState: (path) => this.readConnectorState(path),
				isRunning: (state) => isProcessRunning(state.pid),
				formatAlreadyRunningMessage: (state) =>
					`[telegram] connector already running pid=${state.pid} rpc=${state.rpcAddress}`,
				formatBackgroundStartMessage: (pid) =>
					`[telegram] starting background connector pid=${pid} bot=@${options.botUsername}`,
				foregroundHint:
					"[telegram] use `clite connect telegram -i ...` to run in the foreground",
				launchFailureMessage:
					"failed to launch Telegram connector in background",
			})
		) {
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
		const activeTurns = new Map<string, ActiveConnectorTurn>();
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
		const userInstructionWatcher = createUserInstructionConfigWatcher({
			skills: { workspacePath: startRequest.cwd },
			rules: { workspacePath: startRequest.cwd },
			workflows: { workspacePath: startRequest.cwd },
		});
		await userInstructionWatcher.start().catch(() => undefined);
		const commandCwd = startRequest.cwd || process.cwd();
		const { host: chatCommandHost } = await createWorkspaceChatCommandHost({
			cwd: commandCwd,
			workspaceRoot: startRequest.workspaceRoot || commandCwd,
		});
		const rpcAddress = await ensureCliHubServer(
			startRequest.workspaceRoot || startRequest.cwd || process.cwd(),
			parseHubEndpointOverride(options.rpcAddress),
		);

		const clientId = `telegram-${process.pid}-${Date.now()}`;
		const client = new HubSessionClient({
			address: rpcAddress,
			clientId,
			clientType: "cli",
			displayName: "telegram connector",
			workspaceRoot: startRequest.workspaceRoot || startRequest.cwd,
			cwd: startRequest.cwd,
			metadata: {
				transport: "telegram",
				botUserName: options.botUsername,
			},
		});
		this.writeConnectorState(statePath, {
			botUsername: options.botUsername,
			pid: process.pid,
			rpcAddress,
			startedAt: new Date().toISOString(),
		});
		loggerAdapter.core.log("Telegram connector started", {
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
			loggerAdapter.core.log("Telegram connector stopping", {
				severity: "warn",
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
			const queueKey =
				(await loadThreadState(thread, bindingsPath, startRequest))
					.participantKey || thread.id;
			const runTurn = async () => {
				try {
					await handleConnectorUserTurn({
						thread,
						text,
						client,
						pendingApprovals,
						baseStartRequest: startRequest,
						explicitSystemPrompt:
							options.systemPrompt?.trim() ||
							getConnectorSystemPrompt("WhatsApp"),
						clientId,
						logger: loggerAdapter,
						transport: "telegram",
						botUserName: options.botUsername,
						requestStop,
						bindingsPath,
						hookCommand: options.hookCommand,
						systemRules: TELEGRAM_SYSTEM_RULES,
						errorLabel: "Telegram",
						firstContactMessage: TELEGRAM_FIRST_CONTACT_MESSAGE,
						userInstructionWatcher,
						chatCommandHost,
						activeTurns,
						turnKey: queueKey,
						getSessionMetadata: (currentThread, _clientId, currentState) => ({
							botUserName: options.botUsername,
							telegramThreadId: currentThread.id,
							telegramChannelId: currentThread.channelId,
							...(currentState.participantKey
								? { telegramParticipantKey: currentState.participantKey }
								: {}),
							...(currentState.participantLabel
								? { telegramParticipantLabel: currentState.participantLabel }
								: {}),
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
							loggerAdapter.core.log("Telegram reply completed", {
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
					const message =
						error instanceof Error ? error.message : String(error);
					loggerAdapter.core.error?.("Telegram turn handling failed", {
						transport: "telegram",
						threadId: thread.id,
						error,
					});
					await thread.post(`Telegram bridge error: ${message}`);
				}
			};
			if (activeTurns.has(queueKey)) {
				await runTurn();
				return;
			}
			await enqueueThreadTurn(threadQueues, queueKey, async () => {
				await runTurn();
			});
		};

		bot.onNewMention(async (thread, message) => {
			await thread.subscribe();
			await persistTelegramThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: message.raw,
				errorLabel: "Telegram",
			});
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
			await persistTelegramThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: message.raw,
				errorLabel: "Telegram",
			});
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
						loggerAdapter.core.log(
							"Telegram connector stopping because the RPC server is shutting down",
							{
								severity: "warn",
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
					loggerAdapter.core.log(
						"Telegram connector server event stream failed",
						{
							severity: "warn",
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
		io.writeln("[telegram] send /clear in a chat to start a fresh RPC session");
		io.writeln(
			"[telegram] send /whereami in a chat to get its delivery thread id",
		);
		io.writeln(
			"[telegram] use /tools, /yolo, or /cwd <path> to update runtime settings",
		);
		io.writeln("[telegram] send /exit in a chat or press Ctrl+C to stop");

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
		userInstructionWatcher.stop();
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
		this.removeStateFile(statePath);
		loggerAdapter.core.log("Telegram connector stopped", {
			transport: "telegram",
			pid: process.pid,
		});
		return 0;
	}
}

export const telegramConnector: ConnectCommandDefinition =
	new TelegramConnector();

export const __test__ = {
	findBindingForThread: (
		bindings: ConnectorBindingStore<TelegramThreadState>,
		thread: Pick<Thread<TelegramThreadState>, "id" | "channelId" | "isDM"> & {
			participantKey?: string;
		},
	) => findBindingForThread(bindings, thread),
};
