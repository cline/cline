import { createGoogleChatAdapter } from "@chat-adapter/gchat";
import type { ChatStartSessionRequest } from "@clinebot/core";
import {
	createUserInstructionConfigWatcher,
	HubSessionClient,
} from "@clinebot/core";
import type {
	ConnectGoogleChatOptions,
	GoogleChatConnectorState,
} from "@clinebot/shared";
import { Chat, ConsoleLogger, type Thread } from "chat";
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
	getConnectorSystemRules,
} from "./prompts";

const GCHAT_SYSTEM_RULES = getConnectorSystemRules("Google Chat");

const GCHAT_FIRST_CONTACT_MESSAGE = getConnectorFirstContactMessage();

type GoogleChatThreadState = ConnectorThreadState;

function truncateText(value: string, maxLength = 160): string {
	return truncateConnectorText(value, maxLength);
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

async function buildGoogleChatStartRequest(
	options: ConnectGoogleChatOptions,
	io: ConnectIo,
	loggerConfig: Parameters<
		typeof buildConnectorStartRequest
	>[0]["loggerConfig"],
): Promise<ChatStartSessionRequest> {
	return buildConnectorStartRequest({
		options,
		io,
		loggerConfig,
		systemRules: GCHAT_SYSTEM_RULES,
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

function resolveGoogleChatParticipant(
	rawMessage: unknown,
): { key: string; label?: string } | undefined {
	const raw = asRecord(rawMessage);
	const message = asRecord(raw?.message) ?? raw;
	const sender = asRecord(message?.sender);
	const email = readString(sender?.email);
	const name = readString(sender?.name);
	const displayName =
		readString(sender?.displayName) || readString(sender?.display_name);
	const label = displayName || email || name;
	if (email) {
		return { key: `gchat:email:${email.toLowerCase()}`, label };
	}
	if (name) {
		return { key: `gchat:sender:${name}`, label };
	}
	return undefined;
}

async function persistGoogleChatThreadContext(input: {
	thread: Thread<GoogleChatThreadState>;
	bindingsPath: string;
	baseStartRequest: ChatStartSessionRequest;
	rawMessage: unknown;
	errorLabel: string;
}): Promise<void> {
	const participant = resolveGoogleChatParticipant(input.rawMessage);
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
	const bindingKey =
		typeof delivery.bindingKey === "string"
			? delivery.bindingKey.trim()
			: typeof delivery.participantKey === "string"
				? delivery.participantKey.trim()
				: "";
	if (!threadId && !bindingKey) {
		return;
	}
	const bindings = readBindings<GoogleChatThreadState>(input.bindingsPath);
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

class GoogleChatConnector extends ConnectorBase<
	ConnectGoogleChatOptions,
	GoogleChatConnectorState
> {
	constructor() {
		super("gchat", "Google Chat webhook bridge backed by RPC runtime sessions");
	}

	protected override createCommand(): Command {
		return super
			.createCommand()
			.usage("--base-url <PUBLIC_BASE_URL> [options]")
			.option("--user-name <name>", "Google Chat bot username label")
			.option("--provider <id>", "Provider override")
			.option("--model <id>", "Model override")
			.option("--api-key <key>", "Provider API key override")
			.option("--system <prompt>", "System prompt override")
			.option("--cwd <path>", "Workspace / cwd for runtime")
			.option("--mode <act|plan>", "Agent mode", "act")
			.option("-i, --interactive", "Keep connector in foreground")
			.option("--enable-tools", "Enable tools for Google Chat sessions")
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
			.option(
				"--pubsub-topic <topic>",
				"Optional Pub/Sub topic for all-message events",
			)
			.option("--impersonate-user <email>", "Optional delegation user email")
			.option("--use-adc", "Use Google Application Default Credentials")
			.option("--credentials-json <json>", "Service account credentials JSON")
			.addHelpText(
				"after",
				[
					"",
					"Environment:",
					"  GOOGLE_CHAT_CREDENTIALS      Service account JSON",
					"  GOOGLE_CHAT_USE_ADC=true     Use Application Default Credentials",
					"  GOOGLE_CHAT_PUBSUB_TOPIC     Optional Pub/Sub topic",
					"  GOOGLE_CHAT_IMPERSONATE_USER Optional delegation user",
				].join("\n"),
			);
	}

	protected override readOptions(command: Command): ConnectGoogleChatOptions {
		const opts = command.opts<{
			userName?: string;
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
			pubsubTopic?: string;
			impersonateUser?: string;
			useAdc?: boolean;
			credentialsJson?: string;
		}>();
		const parsedPort =
			this.parseOptionalInteger(opts.port, "port") ??
			Number.parseInt(process.env.PORT ?? "8787", 10);
		const port = Number.isFinite(parsedPort) ? parsedPort : 8787;
		return {
			userName:
				opts.userName?.trim() ||
				process.env.GOOGLE_CHAT_BOT_USERNAME?.trim() ||
				"cline-gchat",
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
			pubsubTopic:
				opts.pubsubTopic?.trim() ||
				process.env.GOOGLE_CHAT_PUBSUB_TOPIC?.trim(),
			impersonateUser:
				opts.impersonateUser?.trim() ||
				process.env.GOOGLE_CHAT_IMPERSONATE_USER?.trim(),
			useApplicationDefaultCredentials:
				Boolean(opts.useAdc) ||
				process.env.GOOGLE_CHAT_USE_ADC?.trim().toLowerCase() === "true",
			credentialsJson:
				opts.credentialsJson?.trim() ||
				process.env.GOOGLE_CHAT_CREDENTIALS?.trim(),
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
	): GoogleChatConnectorState | undefined {
		return this.readStateFile(
			statePath,
			(value): value is GoogleChatConnectorState =>
				Boolean(
					value &&
						typeof value === "object" &&
						typeof (value as GoogleChatConnectorState).pid === "number" &&
						typeof (value as GoogleChatConnectorState).userName === "string",
				),
		);
	}

	private writeConnectorState(
		statePath: string,
		state: GoogleChatConnectorState,
	): void {
		this.writeStateFile(statePath, state);
	}

	private async stopGoogleChatConnectorInstance(
		statePath: string,
		io: ConnectIo,
	): Promise<ConnectStopResult> {
		return this.stopManagedProcess({
			io,
			statePath,
			readState: (path) => this.readConnectorState(path),
			describeStoppedProcess: (state) =>
				`[gchat] stopped pid=${state.pid} user=${state.userName}`,
			getPid: (state) => state.pid,
			stopSessions: stopSessionsForUser,
			clearBindings: (state) => {
				clearBindingSessionIds<GoogleChatThreadState>(
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
				this.stopGoogleChatConnectorInstance(statePath, stopIo),
		);
	}

	protected override async runWithOptions(
		options: ConnectGoogleChatOptions,
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
				childEnvVar: "CLINE_GCHAT_CONNECT_CHILD",
				statePath,
				readState: (path) => this.readConnectorState(path),
				isRunning: (state) => isProcessRunning(state.pid),
				formatAlreadyRunningMessage: (state) =>
					`[gchat] connector already running pid=${state.pid} rpc=${state.rpcAddress} url=${state.baseUrl}`,
				formatBackgroundStartMessage: (pid) =>
					`[gchat] starting background connector pid=${pid} user=${options.userName}`,
				foregroundHint:
					"[gchat] use `clite connect gchat -i ...` to run in the foreground",
				launchFailureMessage:
					"failed to launch Google Chat connector in background",
			})
		) {
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
						typeof parsed.project_id === "string"
							? parsed.project_id
							: undefined,
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
		const activeTurns = new Map<string, ActiveConnectorTurn>();
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

		const clientId = `gchat-${process.pid}-${Date.now()}`;
		const client = new HubSessionClient({
			address: rpcAddress,
			authToken: rpcAuthToken,
			clientId,
			clientType: "cli",
			displayName: "gchat connector",
			workspaceRoot: startRequest.workspaceRoot || startRequest.cwd,
			cwd: startRequest.cwd,
			metadata: {
				transport: "gchat",
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
			thread: Thread<GoogleChatThreadState>,
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
						firstContactMessage: GCHAT_FIRST_CONTACT_MESSAGE,
						userInstructionWatcher,
						chatCommandHost,
						activeTurns,
						turnKey: queueKey,
						getSessionMetadata: (currentThread, _clientId, currentState) => ({
							userName: options.userName,
							gchatThreadId: currentThread.id,
							gchatChannelId: currentThread.channelId,
							...(currentState.participantKey
								? { gchatParticipantKey: currentState.participantKey }
								: {}),
							...(currentState.participantLabel
								? { gchatParticipantLabel: currentState.participantLabel }
								: {}),
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
					const message =
						error instanceof Error ? error.message : String(error);
					await thread.post(`Google Chat bridge error: ${message}`);
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
			await persistGoogleChatThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: message.raw,
				errorLabel: "Google Chat",
			});
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
			await persistGoogleChatThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: message.raw,
				errorLabel: "Google Chat",
			});
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
		userInstructionWatcher.stop();
		client.close();
		this.removeStateFile(statePath);
		return 0;
	}
}

export const gchatConnector: ConnectCommandDefinition =
	new GoogleChatConnector();

export const __test__ = {
	findBindingForThread: (
		bindings: ConnectorBindingStore<GoogleChatThreadState>,
		thread: Pick<Thread<GoogleChatThreadState>, "id" | "channelId" | "isDM"> & {
			participantKey?: string;
		},
	) => findBindingForThread(bindings, thread),
};
