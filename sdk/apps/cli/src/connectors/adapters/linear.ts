import type { ChatStartSessionRequest } from "@clinebot/core";
import { createUserInstructionConfigWatcher } from "@clinebot/core";
import { HubSessionClient } from "@clinebot/hub";
import type {
	ConnectLinearOptions,
	LinearConnectorState,
} from "@clinebot/shared";
import { type Adapter, Chat, ConsoleLogger, type Thread } from "chat";
import type { Command } from "commander";
import type { CliLoggerAdapter } from "../../logging/adapter";
import { createCliLoggerAdapter } from "../../logging/adapter";
import {
	ensureCliHubServer,
	parseHubEndpointOverride,
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
import { getConnectorSystemPrompt } from "./prompts";

const LINEAR_SYSTEM_RULES = [
	"Keep answers compact and optimized for Linear issue comments unless the user asks for detail.",
	"Prefer short paragraphs and concise lists suitable for issue threads.",
	"When tools are disabled, explain limits briefly and ask the user to enable tools if required.",
].join("\n");

const LINEAR_FIRST_CONTACT_MESSAGE = [
	"Connected.",
	"Your chat history is isolated to this Linear identity.",
	"Ask for /whereami if you need the delivery thread details.",
].join("\n");

type LinearThreadState = ConnectorThreadState;

type LinearAdapterModule = {
	createLinearAdapter: (config?: Record<string, unknown>) => unknown;
};

function truncateText(value: string, maxLength = 160): string {
	return truncateConnectorText(value, maxLength);
}

async function importLinearAdapterModule(): Promise<LinearAdapterModule> {
	const dynamicImport = Function("specifier", "return import(specifier);") as (
		specifier: string,
	) => Promise<unknown>;
	const mod = (await dynamicImport(
		"@chat-adapter/linear",
	)) as Partial<LinearAdapterModule>;
	if (typeof mod.createLinearAdapter !== "function") {
		throw new Error(
			"@chat-adapter/linear does not export createLinearAdapter()",
		);
	}
	return { createLinearAdapter: mod.createLinearAdapter };
}

async function stopSessionsForUser(
	state: LinearConnectorState,
): Promise<number> {
	return stopConnectorSessions({
		rpcAddress: state.rpcAddress,
		rpcMatcher: (metadata) =>
			metadata?.transport === "linear" && metadata?.userName === state.userName,
		localMatcher: (metadata) =>
			metadata?.transport === "linear" && metadata?.userName === state.userName,
	});
}

async function buildLinearStartRequest(
	options: ConnectLinearOptions,
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
		systemRules: LINEAR_SYSTEM_RULES,
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

function resolveLinearParticipant(
	rawMessage: unknown,
): { key: string; label?: string } | undefined {
	const raw = asRecord(rawMessage);
	const data = asRecord(raw?.data);
	const actor =
		asRecord(raw?.actor) ??
		asRecord(data?.actor) ??
		asRecord(data?.user) ??
		asRecord(asRecord(data?.comment)?.user);
	const userId =
		readString(actor?.id) ||
		readString(data?.userId) ||
		readString(asRecord(data?.comment)?.userId);
	const email = readString(actor?.email)?.toLowerCase();
	const name =
		readString(actor?.displayName) ||
		readString(actor?.name) ||
		readString(actor?.label);
	const label = name || email || userId;
	if (userId) {
		return {
			key: `linear:user:${userId}`,
			label,
		};
	}
	if (email) {
		return {
			key: `linear:email:${email}`,
			label,
		};
	}
	return undefined;
}

async function persistLinearThreadContext(input: {
	thread: Thread<LinearThreadState>;
	bindingsPath: string;
	baseStartRequest: ChatStartSessionRequest;
	rawMessage: unknown;
	errorLabel: string;
}): Promise<void> {
	const participant = resolveLinearParticipant(input.rawMessage);
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
	if (!delivery || delivery.adapter !== "linear") {
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
	const bindings = readBindings<LinearThreadState>(input.bindingsPath);
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
			adapter: "linear",
			botUserName: input.userName,
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
	) as Thread<LinearThreadState>;
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

class LinearConnector extends ConnectorBase<
	ConnectLinearOptions,
	LinearConnectorState
> {
	constructor() {
		super("linear", "Linear webhook bridge backed by RPC runtime sessions");
	}

	protected override createCommand(): Command {
		return super
			.createCommand()
			.usage("--base-url <PUBLIC_BASE_URL> [options]")
			.option("--user-name <name>", "Linear bot display name")
			.option("--api-key <key>", "Linear personal API key")
			.option("--client-id <id>", "Linear OAuth client id")
			.option("--client-secret <secret>", "Linear OAuth client secret")
			.option("--access-token <token>", "Pre-obtained Linear access token")
			.option("--webhook-secret <secret>", "Linear webhook signing secret")
			.option("--provider <id>", "Provider override")
			.option("--model <id>", "Model override")
			.option("--provider-api-key <key>", "Provider API key override")
			.option("--system <prompt>", "System prompt override")
			.option("--cwd <path>", "Workspace / cwd for runtime")
			.option("--mode <act|plan>", "Agent mode", "act")
			.option("-i, --interactive", "Keep connector in foreground")
			.option("--max-iterations <n>", "Optional max iterations")
			.option("--enable-tools", "Enable tools for Linear sessions")
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
			.option("--base-url <url>", "Public base URL for webhook configuration")
			.addHelpText(
				"after",
				[
					"",
					"Environment:",
					"  LINEAR_API_KEY             Personal API key",
					"  LINEAR_CLIENT_ID           OAuth client id",
					"  LINEAR_CLIENT_SECRET       OAuth client secret",
					"  LINEAR_ACCESS_TOKEN        Pre-obtained access token",
					"  LINEAR_WEBHOOK_SECRET      Webhook signing secret",
					"  LINEAR_BOT_USERNAME        Bot display name (default: linear-bot)",
				].join("\n"),
			);
	}

	protected override readOptions(command: Command): ConnectLinearOptions {
		const opts = command.opts<{
			userName?: string;
			apiKey?: string;
			clientId?: string;
			clientSecret?: string;
			accessToken?: string;
			webhookSecret?: string;
			cwd?: string;
			model?: string;
			provider?: string;
			providerApiKey?: string;
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
		const apiKey = opts.apiKey?.trim() || process.env.LINEAR_API_KEY?.trim();
		const clientId =
			opts.clientId?.trim() || process.env.LINEAR_CLIENT_ID?.trim();
		const clientSecret =
			opts.clientSecret?.trim() || process.env.LINEAR_CLIENT_SECRET?.trim();
		const accessToken =
			opts.accessToken?.trim() || process.env.LINEAR_ACCESS_TOKEN?.trim();
		const webhookSecret =
			opts.webhookSecret?.trim() || process.env.LINEAR_WEBHOOK_SECRET?.trim();
		if (!webhookSecret) {
			throw new Error(
				"connect linear requires --webhook-secret <secret> or LINEAR_WEBHOOK_SECRET",
			);
		}
		if (!apiKey && !accessToken && !(clientId && clientSecret)) {
			throw new Error(
				"connect linear requires LINEAR_API_KEY, LINEAR_ACCESS_TOKEN, or both LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET",
			);
		}
		const parsedPort =
			this.parseOptionalInteger(opts.port, "port") ??
			Number.parseInt(process.env.PORT ?? "8787", 10);
		const port = Number.isFinite(parsedPort) ? parsedPort : 8787;
		return {
			userName:
				opts.userName?.trim() ||
				process.env.LINEAR_BOT_USERNAME?.trim() ||
				"linear-bot",
			apiKey,
			clientId,
			clientSecret,
			accessToken,
			webhookSecret,
			cwd: opts.cwd || process.cwd(),
			model: opts.model,
			provider: opts.provider,
			apiProviderKey: opts.providerApiKey,
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
		return this.resolveConnectorPath(`${this.sanitizeKey(userName)}.json`);
	}

	private resolveBindingsPath(userName: string): string {
		return this.resolveConnectorPath(
			`${this.sanitizeKey(userName)}.threads.json`,
		);
	}

	private listConnectorStatePaths(): string[] {
		return this.listJsonStatePaths([".threads.json"]);
	}

	private readConnectorState(
		statePath: string,
	): LinearConnectorState | undefined {
		return this.readStateFile(
			statePath,
			(value): value is LinearConnectorState =>
				Boolean(
					value &&
						typeof value === "object" &&
						typeof (value as LinearConnectorState).pid === "number" &&
						typeof (value as LinearConnectorState).userName === "string",
				),
		);
	}

	private writeConnectorState(
		statePath: string,
		state: LinearConnectorState,
	): void {
		this.writeStateFile(statePath, state);
	}

	private async stopLinearConnectorInstance(
		statePath: string,
		io: ConnectIo,
	): Promise<ConnectStopResult> {
		return this.stopManagedProcess({
			io,
			statePath,
			readState: (path) => this.readConnectorState(path),
			describeStoppedProcess: (state) =>
				`[linear] stopped pid=${state.pid} user=${state.userName}`,
			getPid: (state) => state.pid,
			stopSessions: stopSessionsForUser,
			clearBindings: (state) => {
				clearBindingSessionIds<LinearThreadState>(
					this.resolveBindingsPath(state.userName),
				);
			},
		});
	}

	override async stopAll(io: ConnectIo): Promise<ConnectStopResult> {
		return this.stopAllFromStatePaths(
			io,
			this.listConnectorStatePaths(),
			(statePath, stopIo) =>
				this.stopLinearConnectorInstance(statePath, stopIo),
		);
	}

	protected override async runWithOptions(
		options: ConnectLinearOptions,
		rawArgs: string[],
		io: ConnectIo,
	): Promise<number> {
		const statePath = this.resolveConnectorStatePath(options.userName);
		const bindingsPath = this.resolveBindingsPath(options.userName);
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
				childEnvVar: "CLINE_LINEAR_CONNECT_CHILD",
				statePath,
				readState: (path) => this.readConnectorState(path),
				isRunning: (state) => isProcessRunning(state.pid),
				formatAlreadyRunningMessage: (state) =>
					`[linear] connector already running pid=${state.pid} rpc=${state.rpcAddress} url=${state.baseUrl}`,
				formatBackgroundStartMessage: (pid) =>
					`[linear] starting background connector pid=${pid} user=${options.userName}`,
				foregroundHint:
					"[linear] use `clite connect linear -i ...` to run in the foreground",
				launchFailureMessage: "failed to launch Linear connector in background",
			})
		) {
			return 0;
		}

		const loggerAdapter = createCliLoggerAdapter({
			runtime: "cli",
			component: "linear-connect",
		});
		const logger = createChatSdkLogger(loggerAdapter);
		const consoleLogger = new ConsoleLogger("info", "linear-connect");
		let linearAdapter: unknown;
		try {
			const { createLinearAdapter } = await importLinearAdapterModule();
			const linearConfig: Record<string, unknown> = {
				webhookSecret: options.webhookSecret,
				userName: options.userName,
				logger: consoleLogger,
			};
			if (options.apiKey) {
				linearConfig.apiKey = options.apiKey;
			}
			if (options.clientId) {
				linearConfig.clientId = options.clientId;
			}
			if (options.clientSecret) {
				linearConfig.clientSecret = options.clientSecret;
			}
			if (options.accessToken) {
				linearConfig.accessToken = options.accessToken;
			}
			linearAdapter = createLinearAdapter(linearConfig);
		} catch (error) {
			io.writeErr(
				`failed to load @chat-adapter/linear: ${error instanceof Error ? error.message : String(error)}`,
			);
			return 1;
		}

		const bot = new Chat({
			userName: options.userName,
			adapters: { linear: linearAdapter as Adapter },
			state: new InMemoryStateAdapter(),
			logger,
			fallbackStreamingPlaceholderText: null,
			streamingUpdateIntervalMs: 500,
		}).registerSingleton();
		const threadQueues = new Map<string, Promise<void>>();
		const activeTurns = new Map<string, ActiveConnectorTurn>();
		const pendingApprovals = new Map<string, PendingConnectorApproval>();
		const startRequest = await buildLinearStartRequest(options, io, {
			enabled: loggerAdapter.runtimeConfig.enabled,
			level: loggerAdapter.runtimeConfig.level,
			destination: loggerAdapter.runtimeConfig.destination,
			bindings: {
				transport: "linear",
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
		const rpcAddress = await ensureCliHubServer(
			startRequest.workspaceRoot || startRequest.cwd || process.cwd(),
			parseHubEndpointOverride(options.rpcAddress),
		);

		const clientId = `linear-${process.pid}-${Date.now()}`;
		const client = new HubSessionClient({
			address: rpcAddress,
			clientId,
			clientType: "cli",
			displayName: "linear connector",
			workspaceRoot: startRequest.workspaceRoot || startRequest.cwd,
			cwd: startRequest.cwd,
			metadata: {
				transport: "linear",
				userName: options.userName,
			},
		});
		await client.connect();
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
			thread: Thread<LinearThreadState>,
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
							getConnectorSystemPrompt("Linear"),
						clientId,
						logger: loggerAdapter,
						transport: "linear",
						botUserName: options.userName,
						requestStop,
						bindingsPath,
						hookCommand: options.hookCommand,
						systemRules: LINEAR_SYSTEM_RULES,
						errorLabel: "Linear",
						firstContactMessage: LINEAR_FIRST_CONTACT_MESSAGE,
						userInstructionWatcher,
						chatCommandHost,
						activeTurns,
						turnKey: queueKey,
						getSessionMetadata: (currentThread, _clientId, currentState) => ({
							userName: options.userName,
							linearThreadId: currentThread.id,
							linearChannelId: currentThread.channelId,
							...(currentState.participantKey
								? { linearParticipantKey: currentState.participantKey }
								: {}),
							...(currentState.participantLabel
								? { linearParticipantLabel: currentState.participantLabel }
								: {}),
						}),
						reusedLogMessage: "Linear thread reusing RPC session",
						onReplyCompleted: async (result) => {
							await dispatchConnectorHook(
								options.hookCommand,
								{
									adapter: "linear",
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
									adapter: "linear",
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
					await thread.post(`Linear bridge error: ${message}`);
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
			await persistLinearThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: message.raw,
				errorLabel: "Linear",
			});
			if (
				await maybeHandleConnectorApprovalReply({
					thread,
					text: message.text,
					client,
					clientId,
					pendingApprovals,
					deniedReason: "Denied by Linear user",
				})
			) {
				return;
			}
			await handleTurn(thread, message.text);
		});

		bot.onSubscribedMessage(async (thread, message) => {
			await persistLinearThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: message.raw,
				errorLabel: "Linear",
			});
			if (
				await maybeHandleConnectorApprovalReply({
					thread,
					text: message.text,
					client,
					clientId,
					pendingApprovals,
					deniedReason: "Denied by Linear user",
				})
			) {
				return;
			}
			await handleTurn(thread, message.text);
		});

		await bot.initialize();
		const stopTaskUpdateStream =
			startConnectorTaskUpdateRelay<LinearThreadState>({
				client,
				clientId,
				bot,
				logger: loggerAdapter,
				bindingsPath,
				transport: "linear",
			});

		const webhookUrl = `${options.baseUrl.replace(/\/$/, "")}/api/webhooks/linear`;
		const server = await startConnectorWebhookServer({
			host: options.host,
			port: options.port,
			routes: {
				"/api/webhooks/linear": async (request) => bot.webhooks.linear(request),
				"/health": () => new Response("ok"),
				"/": () =>
					new Response(
						["Linear connector is running.", `Webhook URL: ${webhookUrl}`].join(
							"\n",
						),
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

		io.writeln(`[linear] listening on ${options.host}:${options.port}`);
		io.writeln(`[linear] configure Linear webhook URL: ${webhookUrl}`);

		await stopPromise;
		stopTaskUpdateStream();
		stopEventStream();
		await server.close();
		userInstructionWatcher.stop();
		await bot.shutdown().catch(() => undefined);
		client.close();
		this.removeStateFile(statePath);
		return 0;
	}
}

export const linearConnector: ConnectCommandDefinition = new LinearConnector();

export const __test__ = {
	findBindingForThread: (
		bindings: ConnectorBindingStore<LinearThreadState>,
		thread: Pick<Thread<LinearThreadState>, "id" | "channelId" | "isDM"> & {
			participantKey?: string;
		},
	) => findBindingForThread(bindings, thread),
};
