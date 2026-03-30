import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import type { RpcChatStartSessionRequest } from "@clinebot/core";
import { createUserInstructionConfigWatcher } from "@clinebot/core";
import { RpcSessionClient, registerRpcClient } from "@clinebot/rpc";
import type {
	ConnectSlackOptions,
	SlackConnectorState,
} from "@clinebot/shared";
import {
	type Adapter,
	Chat,
	ConsoleLogger,
	type Thread,
	ThreadImpl,
} from "chat";
import type { Command } from "commander";
import { ensureRpcRuntimeAddress } from "../../commands/rpc";
import type { CliLoggerAdapter } from "../../logging/adapter";
import { createCliLoggerAdapter } from "../../logging/adapter";
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
import { FileStateAdapter } from "../stores/file-state";
import { startConnectorTaskUpdateRelay } from "../task-updates";
import {
	type ConnectorBindingStore,
	type ConnectorThreadBinding,
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

const SLACK_SYSTEM_RULES = getConnectorSystemRules(
	"Slack",
	"You can respond to user messages in threads and DMs, and you can use tools according to user's requests and your capabilities.",
);

const SLACK_FIRST_CONTACT_MESSAGE = getConnectorFirstContactMessage();

type SlackThreadState = ConnectorThreadState & {
	teamId?: string;
};

function truncateText(value: string, maxLength = 160): string {
	return truncateConnectorText(value, maxLength);
}

function sanitizeKey(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: undefined;
}

function firstRecord(value: unknown): Record<string, unknown> | undefined {
	return Array.isArray(value) ? asRecord(value[0]) : undefined;
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildSlackParticipantKey(teamId: string, userId: string): string {
	return `slack:team:${teamId}:user:${userId}`;
}

function resolveSlackParticipant(
	rawMessage: unknown,
	teamId?: string,
): { key: string; label?: string } | undefined {
	const raw = asRecord(rawMessage);
	const event = asRecord(raw?.event);
	const message = asRecord(raw?.message);
	const user =
		readString(raw?.user) ||
		readString(event?.user) ||
		readString(message?.user) ||
		readString(firstRecord(raw?.authorizations)?.user_id);
	const username =
		readString(raw?.username) ||
		readString(event?.username) ||
		readString(message?.username);
	const label = username || user;
	if (!user || !teamId?.trim()) {
		return undefined;
	}
	return {
		key: buildSlackParticipantKey(teamId.trim(), user),
		label,
	};
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
	const participant = resolveSlackParticipant(input.rawMessage, teamId);
	if (!teamId) {
		return;
	}
	const currentState = await loadThreadState(
		input.thread,
		input.bindingsPath,
		input.baseStartRequest,
	);
	if (
		currentState.teamId === teamId &&
		currentState.participantKey === participant?.key &&
		currentState.participantLabel === participant?.label
	) {
		return;
	}
	await persistMergedThreadState(
		input.thread,
		input.bindingsPath,
		{
			...currentState,
			teamId: teamId ?? currentState.teamId,
			participantKey: participant?.key ?? currentState.participantKey,
			participantLabel: participant?.label ?? currentState.participantLabel,
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
	const bindingKey =
		typeof delivery.bindingKey === "string"
			? delivery.bindingKey.trim()
			: typeof delivery.participantKey === "string"
				? delivery.participantKey.trim()
				: "";
	if (!threadId && !bindingKey) {
		return;
	}
	const bindings = readBindings<SlackThreadState>(input.bindingsPath);
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

class SlackConnector extends ConnectorBase<
	ConnectSlackOptions,
	SlackConnectorState
> {
	constructor() {
		super("slack", "Slack webhook bridge backed by RPC runtime sessions");
	}

	protected override createCommand(): Command {
		return super
			.createCommand()
			.usage("--base-url <PUBLIC_BASE_URL> [options]")
			.option("--user-name <name>", "Slack bot username label")
			.option(
				"--bot-token <token>",
				"Slack bot token for single-workspace mode",
			)
			.option("--signing-secret <secret>", "Slack signing secret")
			.option("--client-id <id>", "Slack OAuth client id")
			.option("--client-secret <secret>", "Slack OAuth client secret")
			.option(
				"--encryption-key <key>",
				"Base64 32-byte key for encrypted installations",
			)
			.option(
				"--installation-key-prefix <prefix>",
				"Override stored installation key prefix",
			)
			.option("--provider <id>", "Provider override")
			.option("--model <id>", "Model override")
			.option("--api-key <key>", "Provider API key override")
			.option("--system <prompt>", "System prompt override")
			.option("--cwd <path>", "Workspace / cwd for runtime")
			.option("--mode <act|plan>", "Agent mode", "act")
			.option("-i, --interactive", "Keep connector in foreground")
			.option("--max-iterations <n>", "Optional max iterations")
			.option("--enable-tools", "Enable tools for Slack sessions")
			.option(
				"--hook-command <command>",
				"Run a shell command for connector events",
			)
			.option(
				"--rpc-address <host:port>",
				"RPC address",
				process.env.CLINE_RPC_ADDRESS?.trim() || "127.0.0.1:4317",
			)
			.option("--host <host>", "Webhook listen host")
			.option("--port <port>", "Webhook listen port")
			.option(
				"--base-url <url>",
				"Public base URL for webhooks and OAuth callback",
			)
			.addHelpText(
				"after",
				[
					"",
					"Environment:",
					"  SLACK_BOT_TOKEN             Single-workspace bot token",
					"  SLACK_SIGNING_SECRET        Slack signing secret",
					"  SLACK_CLIENT_ID             OAuth client id",
					"  SLACK_CLIENT_SECRET         OAuth client secret",
					"  SLACK_ENCRYPTION_KEY        Optional installation encryption key",
				].join("\n"),
			);
	}

	protected override readOptions(command: Command): ConnectSlackOptions {
		const opts = command.opts<{
			userName?: string;
			botToken?: string;
			signingSecret?: string;
			clientId?: string;
			clientSecret?: string;
			encryptionKey?: string;
			installationKeyPrefix?: string;
			cwd?: string;
			model?: string;
			provider?: string;
			apiKey?: string;
			system?: string;
			mode?: string;
			interactive?: boolean;
			maxIterations?: string;
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
		return {
			userName:
				opts.userName?.trim() ||
				process.env.SLACK_BOT_USERNAME?.trim() ||
				"cline-slack",
			botToken: opts.botToken?.trim() || process.env.SLACK_BOT_TOKEN?.trim(),
			signingSecret:
				opts.signingSecret?.trim() || process.env.SLACK_SIGNING_SECRET?.trim(),
			clientId: opts.clientId?.trim() || process.env.SLACK_CLIENT_ID?.trim(),
			clientSecret:
				opts.clientSecret?.trim() || process.env.SLACK_CLIENT_SECRET?.trim(),
			encryptionKey:
				opts.encryptionKey?.trim() || process.env.SLACK_ENCRYPTION_KEY?.trim(),
			installationKeyPrefix:
				opts.installationKeyPrefix?.trim() ||
				process.env.SLACK_INSTALLATION_KEY_PREFIX?.trim(),
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
			enableTools: Boolean(opts.enableTools),
			rpcAddress:
				opts.rpcAddress?.trim() ||
				process.env.CLINE_RPC_ADDRESS?.trim() ||
				"127.0.0.1:4317",
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

	private resolveConnectorStatePath(userName: string): string {
		return this.resolveConnectorPath(`${sanitizeKey(userName)}.json`);
	}

	private resolveBindingsPath(userName: string): string {
		return this.resolveConnectorPath(`${sanitizeKey(userName)}.threads.json`);
	}

	private resolveStateStorePath(userName: string): string {
		return this.resolveConnectorPath(`${sanitizeKey(userName)}.state.json`);
	}

	private listConnectorStatePaths(): string[] {
		return this.listJsonStatePaths([".threads.json", ".state.json"]);
	}

	private readConnectorState(
		statePath: string,
	): SlackConnectorState | undefined {
		return this.readStateFile(
			statePath,
			(value): value is SlackConnectorState =>
				Boolean(
					value &&
						typeof value === "object" &&
						typeof (value as SlackConnectorState).pid === "number" &&
						typeof (value as SlackConnectorState).userName === "string",
				),
		);
	}

	private writeConnectorState(
		statePath: string,
		state: SlackConnectorState,
	): void {
		this.writeStateFile(statePath, state);
	}

	private async stopSlackConnectorInstance(
		statePath: string,
		io: ConnectIo,
	): Promise<ConnectStopResult> {
		return this.stopManagedProcess({
			io,
			statePath,
			readState: (path) => this.readConnectorState(path),
			describeStoppedProcess: (state) =>
				`[slack] stopped pid=${state.pid} user=${state.userName}`,
			getPid: (state) => state.pid,
			stopSessions: stopSessionsForUser,
			clearBindings: (state) => {
				clearBindingSessionIds<SlackThreadState>(
					this.resolveBindingsPath(state.userName),
				);
			},
		});
	}

	override async stopAll(io: ConnectIo): Promise<ConnectStopResult> {
		return this.stopAllFromStatePaths(
			io,
			this.listConnectorStatePaths(),
			(statePath, stopIo) => this.stopSlackConnectorInstance(statePath, stopIo),
		);
	}

	protected override async runWithOptions(
		options: ConnectSlackOptions,
		rawArgs: string[],
		io: ConnectIo,
	): Promise<number> {
		const statePath = this.resolveConnectorStatePath(options.userName);
		const bindingsPath = this.resolveBindingsPath(options.userName);
		const stateStorePath = this.resolveStateStorePath(options.userName);
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
				childEnvVar: "CLINE_SLACK_CONNECT_CHILD",
				statePath,
				readState: (path) => this.readConnectorState(path),
				isRunning: (state) => isProcessRunning(state.pid),
				formatAlreadyRunningMessage: (state) =>
					`[slack] connector already running pid=${state.pid} rpc=${state.rpcAddress} url=${state.baseUrl}`,
				formatBackgroundStartMessage: (pid) =>
					`[slack] starting background connector pid=${pid} user=${options.userName}`,
				foregroundHint:
					"[slack] use `clite connect slack -i ...` to run in the foreground",
				launchFailureMessage: "failed to launch Slack connector in background",
			})
		) {
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
		const activeTurns = new Map<string, ActiveConnectorTurn>();
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
		const userInstructionWatcher = createUserInstructionConfigWatcher({
			skills: { workspacePath: startRequest.cwd },
			rules: { workspacePath: startRequest.cwd },
			workflows: { workspacePath: startRequest.cwd },
		});
		await userInstructionWatcher.start().catch(() => undefined);
		const commandCwd = startRequest.cwd || process.cwd();
		const chatCommandHost = await createWorkspaceChatCommandHost({
			cwd: commandCwd,
			workspaceRoot: startRequest.workspaceRoot || commandCwd,
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
		this.writeConnectorState(statePath, {
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
			thread: Thread<SlackThreadState>,
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
							options.systemPrompt?.trim() || getConnectorSystemPrompt("slack"),
						clientId,
						logger: loggerAdapter,
						transport: "slack",
						botUserName: options.userName,
						requestStop,
						bindingsPath,
						hookCommand: options.hookCommand,
						systemRules: SLACK_SYSTEM_RULES,
						errorLabel: "Slack",
						firstContactMessage: SLACK_FIRST_CONTACT_MESSAGE,
						userInstructionWatcher,
						chatCommandHost,
						activeTurns,
						turnKey: queueKey,
						getSessionMetadata: (currentThread, _clientId, currentState) => ({
							userName: options.userName,
							slackThreadId: currentThread.id,
							slackChannelId: currentThread.channelId,
							...(currentState.participantKey
								? { slackParticipantKey: currentState.participantKey }
								: {}),
							...(currentState.participantLabel
								? { slackParticipantLabel: currentState.participantLabel }
								: {}),
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
					const message =
						error instanceof Error ? error.message : String(error);
					await thread.post(`Slack bridge error: ${message}`);
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

		bot.onSlashCommand(async (event) => {
			const commandText = [event.command.trim(), event.text.trim()]
				.filter(Boolean)
				.join(" ");
			const rootMessage = await event.channel.post(
				`${event.user.fullName} invoked ${commandText}`,
			);
			const thread = new ThreadImpl<SlackThreadState>({
				adapterName: "slack",
				channelId: event.channel.id,
				id: rootMessage.threadId,
				isDM: event.channel.isDM,
				isSubscribedContext: true,
			});
			await thread.subscribe();
			await persistSlackThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: event.raw,
				errorLabel: "Slack",
			});
			await handleTurn(thread, commandText);
		});

		await bot.initialize();
		const stopTaskUpdateStream =
			startConnectorTaskUpdateRelay<SlackThreadState>({
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
		io.writeln(
			`[slack] configure Slack OAuth callback URL: ${oauthCallbackUrl}`,
		);

		await stopPromise;
		stopTaskUpdateStream();
		stopEventStream();
		await server.close();
		userInstructionWatcher.stop();
		client.close();
		this.removeStateFile(statePath);
		return 0;
	}
}

export const slackConnector: ConnectCommandDefinition = new SlackConnector();

export const __test__ = {
	buildSlackParticipantKey,
	resolveSlackParticipant,
	findBindingForThread: (
		bindings: ConnectorBindingStore<SlackThreadState>,
		thread: Pick<Thread<SlackThreadState>, "id" | "channelId" | "isDM"> & {
			participantKey?: string;
		},
	) => findBindingForThread(bindings, thread),
};
