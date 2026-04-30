import {
	createDiscordAdapter,
	type DiscordAdapter,
} from "@chat-adapter/discord";
import type { ChatStartSessionRequest } from "@clinebot/core";
import {
	createUserInstructionConfigWatcher,
	HubSessionClient,
} from "@clinebot/core";
import type {
	ConnectDiscordOptions,
	DiscordConnectorState,
} from "@clinebot/shared";
import { Chat, ConsoleLogger, type Thread, ThreadImpl } from "chat";
import type { Command } from "commander";
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

const DISCORD_SYSTEM_RULES = getConnectorSystemRules(
	"Discord",
	"You can respond in Discord threads, channels, and DMs, and you can use tools according to the user's requests and your capabilities.",
);

const DISCORD_FIRST_CONTACT_MESSAGE = getConnectorFirstContactMessage();
const DISCORD_GATEWAY_DURATION_MS = 1_800_000_000;

type DiscordThreadState = ConnectorThreadState;

function truncateText(value: string, maxLength = 160): string {
	return truncateConnectorText(value, maxLength);
}

async function stopSessionsForApplication(
	state: DiscordConnectorState,
): Promise<number> {
	return stopConnectorSessions({
		rpcAddress: state.rpcAddress,
		rpcMatcher: (metadata) =>
			metadata?.transport === "discord" &&
			metadata?.applicationId === state.applicationId,
		localMatcher: (metadata) =>
			metadata?.transport === "discord" &&
			metadata?.applicationId === state.applicationId,
	});
}

async function buildDiscordStartRequest(
	options: ConnectDiscordOptions,
	io: ConnectIo,
	loggerConfig: Parameters<
		typeof buildConnectorStartRequest
	>[0]["loggerConfig"],
): Promise<ChatStartSessionRequest> {
	return buildConnectorStartRequest({
		options,
		io,
		loggerConfig,
		systemRules: DISCORD_SYSTEM_RULES,
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

function resolveDiscordParticipant(
	rawMessage: unknown,
): { key: string; label?: string } | undefined {
	const raw = asRecord(rawMessage);
	const data = asRecord(raw?.data) ?? raw;
	const member = asRecord(data?.member);
	const author =
		asRecord(data?.author) ?? asRecord(member?.user) ?? asRecord(data?.user);
	const userId = readIdentifier(author?.id);
	const username = readString(author?.username);
	const globalName =
		readString(author?.global_name) || readString(author?.displayName);
	const label = globalName || username || userId;
	if (!userId) {
		return undefined;
	}
	return { key: `discord:user:${userId}`, label };
}

async function persistDiscordThreadContext(input: {
	thread: Thread<DiscordThreadState>;
	bindingsPath: string;
	baseStartRequest: ChatStartSessionRequest;
	rawMessage: unknown;
	errorLabel: string;
}): Promise<void> {
	const participant = resolveDiscordParticipant(input.rawMessage);
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
	bindingsPath: string;
	userName: string;
	scheduleId: string;
	sessionId?: string;
	status: string;
	errorMessage?: string;
}): Promise<void> {
	const schedule = await input.client.getSchedule(input.scheduleId);
	const delivery = schedule?.metadata?.delivery as
		| Record<string, unknown>
		| undefined;
	if (!delivery || delivery.adapter !== "discord") {
		return;
	}
	const targetUser =
		typeof delivery.userName === "string" ? delivery.userName.trim() : "";
	if (targetUser && targetUser !== input.userName) {
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
	const bindings = readBindings<DiscordThreadState>(input.bindingsPath);
	const match = bindingKey
		? findBindingForParticipantKey(bindings, bindingKey)
		: threadId
			? { key: threadId, binding: bindings[threadId] }
			: undefined;
	const binding = match?.binding;
	if (!binding?.serializedThread) {
		return;
	}
	const thread = JSON.parse(
		binding.serializedThread,
		input.bot.reviver(),
	) as Thread<DiscordThreadState>;
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

class DiscordConnector extends ConnectorBase<
	ConnectDiscordOptions,
	DiscordConnectorState
> {
	constructor() {
		super(
			"discord",
			"Discord interactions and gateway bridge backed by RPC runtime sessions",
		);
	}

	protected override createCommand(): Command {
		return super
			.createCommand()
			.usage("--base-url <PUBLIC_BASE_URL> [options]")
			.option("--user-name <name>", "Discord bot username label")
			.option("--application-id <id>", "Discord application id")
			.option("--bot-token <token>", "Discord bot token")
			.option("--public-key <key>", "Discord application public key")
			.option(
				"--mention-role-ids <ids>",
				"Comma-separated role IDs that should trigger mention handlers",
			)
			.option("--provider <id>", "Provider override")
			.option("--model <id>", "Model override")
			.option("--api-key <key>", "Provider API key override")
			.option("--system <prompt>", "System prompt override")
			.option("--cwd <path>", "Workspace / cwd for runtime")
			.option("--mode <act|plan>", "Agent mode", "act")
			.option("-i, --interactive", "Keep connector in foreground")
			.option("--enable-tools", "Enable tools for Discord sessions")
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
			.option(
				"--base-url <url>",
				"Public base URL for Discord interactions webhook",
			)
			.addHelpText(
				"after",
				[
					"",
					"Environment:",
					"  DISCORD_APPLICATION_ID      Discord application id",
					"  DISCORD_BOT_TOKEN           Discord bot token",
					"  DISCORD_PUBLIC_KEY          Discord application public key",
					"  DISCORD_MENTION_ROLE_IDS    Optional comma-separated role ids",
				].join("\n"),
			);
	}

	protected override readOptions(command: Command): ConnectDiscordOptions {
		const opts = command.opts<{
			userName?: string;
			applicationId?: string;
			botToken?: string;
			publicKey?: string;
			mentionRoleIds?: string;
			cwd?: string;
			model?: string;
			provider?: string;
			apiKey?: string;
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
		const parsedPort =
			this.parseOptionalInteger(opts.port, "port") ??
			Number.parseInt(process.env.PORT ?? "8787", 10);
		const port = Number.isFinite(parsedPort) ? parsedPort : 8787;
		const mentionRoleIds = (
			opts.mentionRoleIds?.trim() ||
			process.env.DISCORD_MENTION_ROLE_IDS?.trim() ||
			""
		)
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean);
		return {
			userName:
				opts.userName?.trim() ||
				process.env.DISCORD_BOT_USERNAME?.trim() ||
				"cline-discord",
			applicationId:
				opts.applicationId?.trim() ||
				process.env.DISCORD_APPLICATION_ID?.trim() ||
				"",
			botToken:
				opts.botToken?.trim() || process.env.DISCORD_BOT_TOKEN?.trim() || "",
			publicKey:
				opts.publicKey?.trim() || process.env.DISCORD_PUBLIC_KEY?.trim() || "",
			mentionRoleIds: mentionRoleIds.length > 0 ? mentionRoleIds : undefined,
			cwd: opts.cwd || process.cwd(),
			model: opts.model,
			provider: opts.provider,
			apiKey: opts.apiKey,
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

	private resolveConnectorStatePath(applicationId: string): string {
		return this.resolveConnectorPath(`${this.sanitizeKey(applicationId)}.json`);
	}

	private resolveBindingsPath(applicationId: string): string {
		return this.resolveConnectorPath(
			`${this.sanitizeKey(applicationId)}.threads.json`,
		);
	}

	private listConnectorStatePaths(): string[] {
		return this.listJsonStatePaths([".threads.json"]);
	}

	private readConnectorState(
		statePath: string,
	): DiscordConnectorState | undefined {
		return this.readStateFile(
			statePath,
			(value): value is DiscordConnectorState =>
				Boolean(
					value &&
						typeof value === "object" &&
						typeof (value as DiscordConnectorState).pid === "number" &&
						typeof (value as DiscordConnectorState).applicationId === "string",
				),
		);
	}

	private writeConnectorState(
		statePath: string,
		state: DiscordConnectorState,
	): void {
		this.writeStateFile(statePath, state);
	}

	private async stopDiscordConnectorInstance(
		statePath: string,
		io: ConnectIo,
	): Promise<ConnectStopResult> {
		return this.stopManagedProcess({
			io,
			statePath,
			readState: (path) => this.readConnectorState(path),
			describeStoppedProcess: (state) =>
				`[discord] stopped pid=${state.pid} application=${state.applicationId}`,
			getPid: (state) => state.pid,
			stopSessions: stopSessionsForApplication,
			clearBindings: (state) => {
				clearBindingSessionIds<DiscordThreadState>(
					this.resolveBindingsPath(state.applicationId),
				);
			},
		});
	}

	override async stopAll(io: ConnectIo): Promise<ConnectStopResult> {
		return this.stopAllFromStatePaths(
			io,
			this.listConnectorStatePaths(),
			(statePath, stopIo) =>
				this.stopDiscordConnectorInstance(statePath, stopIo),
		);
	}

	protected override async runWithOptions(
		options: ConnectDiscordOptions,
		rawArgs: string[],
		io: ConnectIo,
	): Promise<number> {
		if (!options.applicationId) {
			io.writeErr(
				"connect discord requires --application-id <id> or DISCORD_APPLICATION_ID",
			);
			return 1;
		}
		if (!options.botToken) {
			io.writeErr(
				"connect discord requires --bot-token <token> or DISCORD_BOT_TOKEN",
			);
			return 1;
		}
		if (!options.publicKey) {
			io.writeErr(
				"connect discord requires --public-key <key> or DISCORD_PUBLIC_KEY",
			);
			return 1;
		}

		const statePath = this.resolveConnectorStatePath(options.applicationId);
		const bindingsPath = this.resolveBindingsPath(options.applicationId);
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
				childEnvVar: "CLINE_DISCORD_CONNECT_CHILD",
				statePath,
				readState: (path) => this.readConnectorState(path),
				isRunning: (state) => isProcessRunning(state.pid),
				formatAlreadyRunningMessage: (state) =>
					`[discord] connector already running pid=${state.pid} rpc=${state.rpcAddress} url=${state.baseUrl}`,
				formatBackgroundStartMessage: (pid) =>
					`[discord] starting background connector pid=${pid} application=${options.applicationId}`,
				foregroundHint:
					"[discord] use `clite connect discord -i ...` to run in the foreground",
				launchFailureMessage:
					"failed to launch Discord connector in background",
			})
		) {
			return 0;
		}

		const loggerAdapter = createCliLoggerAdapter({
			runtime: "cli",
			component: "discord-connect",
		});
		const logger = createChatSdkLogger(loggerAdapter);
		const consoleLogger = new ConsoleLogger("info", "discord-connect");
		const discord = createDiscordAdapter({
			userName: options.userName,
			applicationId: options.applicationId,
			botToken: options.botToken,
			publicKey: options.publicKey,
			mentionRoleIds: options.mentionRoleIds,
			logger: consoleLogger,
		}) as DiscordAdapter;
		const bot = new Chat({
			userName: options.userName,
			adapters: { discord },
			state: new InMemoryStateAdapter(),
			logger,
			fallbackStreamingPlaceholderText: null,
			streamingUpdateIntervalMs: 500,
		}).registerSingleton();
		const threadQueues = new Map<string, Promise<void>>();
		const activeTurns = new Map<string, ActiveConnectorTurn>();
		const pendingApprovals = new Map<string, PendingConnectorApproval>();
		const startRequest = await buildDiscordStartRequest(options, io, {
			enabled: loggerAdapter.runtimeConfig.enabled,
			level: loggerAdapter.runtimeConfig.level,
			destination: loggerAdapter.runtimeConfig.destination,
			bindings: {
				transport: "discord",
				applicationId: options.applicationId,
				userName: options.userName,
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
		const { url: rpcAddress, authToken: rpcAuthToken } =
			await ensureCliHubServer(
				startRequest.workspaceRoot || startRequest.cwd || process.cwd(),
				parseHubEndpointOverride(options.rpcAddress),
			);

		const clientId = `discord-${process.pid}-${Date.now()}`;
		const client = new HubSessionClient({
			address: rpcAddress,
			authToken: rpcAuthToken,
			clientId,
			clientType: "cli",
			displayName: "discord connector",
			workspaceRoot: startRequest.workspaceRoot || startRequest.cwd,
			cwd: startRequest.cwd,
			metadata: {
				transport: "discord",
				applicationId: options.applicationId,
				userName: options.userName,
			},
		});
		await client.connect();
		this.writeConnectorState(statePath, {
			userName: options.userName,
			applicationId: options.applicationId,
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
			thread: Thread<DiscordThreadState>,
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
							getConnectorSystemPrompt("discord"),
						clientId,
						logger: loggerAdapter,
						transport: "discord",
						botUserName: options.userName,
						requestStop,
						bindingsPath,
						hookCommand: options.hookCommand,
						systemRules: DISCORD_SYSTEM_RULES,
						errorLabel: "Discord",
						firstContactMessage: DISCORD_FIRST_CONTACT_MESSAGE,
						userInstructionWatcher,
						chatCommandHost,
						activeTurns,
						turnKey: queueKey,
						getSessionMetadata: (currentThread, _clientId, currentState) => ({
							userName: options.userName,
							applicationId: options.applicationId,
							discordThreadId: currentThread.id,
							discordChannelId: currentThread.channelId,
							...(currentState.participantKey
								? { discordParticipantKey: currentState.participantKey }
								: {}),
							...(currentState.participantLabel
								? { discordParticipantLabel: currentState.participantLabel }
								: {}),
						}),
						reusedLogMessage: "Discord thread reusing RPC session",
						startedLogMessage: "Discord thread started RPC session",
						onMessageReceived: async (details) => {
							await dispatchConnectorHook(
								options.hookCommand,
								{
									adapter: "discord",
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
									adapter: "discord",
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
									adapter: "discord",
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
					const message =
						error instanceof Error ? error.message : String(error);
					await thread.post(`Discord bridge error: ${message}`);
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
			await persistDiscordThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: message.raw,
				errorLabel: "Discord",
			});
			if (
				await maybeHandleConnectorApprovalReply({
					thread,
					text: message.text,
					client,
					clientId,
					pendingApprovals,
					deniedReason: "Denied by Discord user",
				})
			) {
				return;
			}
			await handleTurn(thread, message.text);
		});

		bot.onSubscribedMessage(async (thread, message) => {
			await persistDiscordThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: message.raw,
				errorLabel: "Discord",
			});
			if (
				await maybeHandleConnectorApprovalReply({
					thread,
					text: message.text,
					client,
					clientId,
					pendingApprovals,
					deniedReason: "Denied by Discord user",
				})
			) {
				return;
			}
			await handleTurn(thread, message.text);
		});

		bot.onSlashCommand(async (event) => {
			const commandText = [event.command.trim(), event.text.trim()]
				.filter(Boolean)
				.join(" ");
			const displayName =
				event.user.fullName || event.user.userName || event.user.userId;
			const rootMessage = await event.channel.post(
				`${displayName} invoked ${commandText}`,
			);
			const thread = new ThreadImpl<DiscordThreadState>({
				adapterName: "discord",
				channelId: event.channel.id,
				id: rootMessage.threadId,
				isDM: event.channel.isDM,
				isSubscribedContext: true,
			});
			await thread.subscribe();
			await persistDiscordThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: event.raw,
				errorLabel: "Discord",
			});
			await handleTurn(thread, commandText);
		});

		await bot.initialize();
		const stopTaskUpdateStream =
			startConnectorTaskUpdateRelay<DiscordThreadState>({
				client,
				clientId,
				bot,
				logger: loggerAdapter,
				bindingsPath,
				transport: "discord",
			});

		let gatewayTask: Promise<unknown> | undefined;
		const gatewayAbortController = new AbortController();
		const gatewayStartResponse = await discord.startGatewayListener(
			{
				waitUntil: (task) => {
					gatewayTask = Promise.resolve(task).catch((error) => {
						loggerAdapter.core.error?.("Discord gateway listener failed", {
							transport: "discord",
							error: error instanceof Error ? error.message : String(error),
						});
						requestStop("discord_gateway_failed");
					});
				},
			},
			DISCORD_GATEWAY_DURATION_MS,
			gatewayAbortController.signal,
		);
		if (!gatewayStartResponse.ok) {
			stopTaskUpdateStream();
			userInstructionWatcher.stop();
			client.close();
			this.removeStateFile(statePath);
			io.writeErr(
				`failed to start Discord gateway listener: ${await gatewayStartResponse.text()}`,
			);
			return 1;
		}

		const webhookUrl = `${options.baseUrl.replace(/\/$/, "")}/api/webhooks/discord`;
		const server = await startConnectorWebhookServer({
			host: options.host,
			port: options.port,
			routes: {
				"/api/webhooks/discord": async (request) =>
					discord.handleWebhook(request),
				"/health": () => new Response("ok"),
				"/": () =>
					new Response(
						[
							"Discord connector is running.",
							`Interactions endpoint: ${webhookUrl}`,
							"Gateway mode: direct WebSocket listener",
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
					if (!scheduleId || !status) {
						return;
					}
					void deliverScheduledResult({
						bot,
						client,
						bindingsPath,
						userName: options.userName,
						scheduleId,
						sessionId,
						status,
						errorMessage,
					});
				},
				onError: () => {
					requestStop("rpc_server_event_stream_failed");
				},
			},
		);

		process.once("SIGINT", () => requestStop("sigint"));
		process.once("SIGTERM", () => requestStop("sigterm"));

		io.writeln(`[discord] listening on ${options.host}:${options.port}`);
		io.writeln(
			`[discord] configure Discord interactions endpoint: ${webhookUrl}`,
		);
		io.writeln(
			"[discord] gateway listener started for mentions, replies, reactions, and DMs",
		);

		await stopPromise;
		gatewayAbortController.abort();
		stopTaskUpdateStream();
		stopEventStream();
		await gatewayTask?.catch(() => undefined);
		await server.close();
		userInstructionWatcher.stop();
		client.close();
		this.removeStateFile(statePath);
		return 0;
	}
}

export const discordConnector: ConnectCommandDefinition =
	new DiscordConnector();

export const __test__ = {
	findBindingForThread: (
		bindings: ConnectorBindingStore<DiscordThreadState>,
		thread: Pick<Thread<DiscordThreadState>, "id" | "channelId" | "isDM"> & {
			participantKey?: string;
		},
	) => findBindingForThread(bindings, thread),
};
