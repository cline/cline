import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
import type { ChatStartSessionRequest } from "@clinebot/core";
import { createUserInstructionConfigWatcher } from "@clinebot/core";
import { HubSessionClient } from "@clinebot/hub";
import type {
	ConnectWhatsAppOptions,
	WhatsAppConnectorState,
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

const WHATSAPP_SYSTEM_RULES = getConnectorSystemRules(
	"WhatsApp",
	"You can respond to user messages in threads and DMs, and you can use tools according to user's requests and your capabilities.",
);

const WHATSAPP_FIRST_CONTACT_MESSAGE = getConnectorFirstContactMessage();

type WhatsAppThreadState = ConnectorThreadState;

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

async function buildWhatsAppStartRequest(
	options: ConnectWhatsAppOptions,
	io: ConnectIo,
	loggerConfig: Parameters<
		typeof buildConnectorStartRequest
	>[0]["loggerConfig"],
): Promise<ChatStartSessionRequest> {
	return buildConnectorStartRequest({
		options,
		io,
		loggerConfig,
		systemRules: WHATSAPP_SYSTEM_RULES,
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

function resolveWhatsAppParticipant(
	rawMessage: unknown,
): { key: string; label?: string } | undefined {
	const raw = asRecord(rawMessage);
	const contact = asRecord(raw?.contact) ?? firstRecord(raw?.contacts);
	const profile = asRecord(contact?.profile);
	const phone =
		readString(raw?.from) ||
		readString(raw?.wa_id) ||
		readString(contact?.wa_id);
	const label = readString(profile?.name) || phone;
	if (!phone) {
		return undefined;
	}
	return {
		key: `whatsapp:user:${phone}`,
		label,
	};
}

async function persistWhatsAppThreadContext(input: {
	thread: Thread<WhatsAppThreadState>;
	bindingsPath: string;
	baseStartRequest: ChatStartSessionRequest;
	rawMessage: unknown;
	errorLabel: string;
}): Promise<void> {
	const participant = resolveWhatsAppParticipant(input.rawMessage);
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
	const bindingKey =
		typeof delivery.bindingKey === "string"
			? delivery.bindingKey.trim()
			: typeof delivery.participantKey === "string"
				? delivery.participantKey.trim()
				: "";
	if (!threadId && !bindingKey) {
		return;
	}
	const bindings = readBindings<WhatsAppThreadState>(input.bindingsPath);
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

class WhatsAppConnector extends ConnectorBase<
	ConnectWhatsAppOptions,
	WhatsAppConnectorState
> {
	constructor() {
		super(
			"whatsapp",
			"WhatsApp Business webhook bridge backed by RPC runtime sessions",
		);
	}

	protected override createCommand(): Command {
		return super
			.createCommand()
			.usage("--base-url <PUBLIC_BASE_URL> [options]")
			.option("--user-name <name>", "WhatsApp bot username label")
			.option("--phone-number-id <id>", "WhatsApp Business phone number id")
			.option("--access-token <token>", "Meta access token")
			.option("--app-secret <secret>", "Meta app secret")
			.option("--verify-token <token>", "Webhook verify token")
			.option("--api-version <version>", "Graph API version", "v21.0")
			.option("--provider <id>", "Provider override")
			.option("--model <id>", "Model override")
			.option("--api-key <key>", "Provider API key override")
			.option("--system <prompt>", "System prompt override")
			.option("--cwd <path>", "Workspace / cwd for runtime")
			.option("--mode <act|plan>", "Agent mode", "act")
			.option("-i, --interactive", "Keep connector in foreground")
			.option("--max-iterations <n>", "Optional max iterations")
			.option("--enable-tools", "Enable tools for WhatsApp sessions")
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
					"  WHATSAPP_ACCESS_TOKEN       Meta access token",
					"  WHATSAPP_APP_SECRET         Meta app secret",
					"  WHATSAPP_PHONE_NUMBER_ID    WhatsApp Business phone number id",
					"  WHATSAPP_VERIFY_TOKEN       Webhook verification token",
					"  WHATSAPP_BOT_USERNAME       Bot username label",
				].join("\n"),
			);
	}

	protected override readOptions(command: Command): ConnectWhatsAppOptions {
		const opts = command.opts<{
			userName?: string;
			phoneNumberId?: string;
			accessToken?: string;
			appSecret?: string;
			verifyToken?: string;
			apiVersion?: string;
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
				process.env.WHATSAPP_BOT_USERNAME?.trim() ||
				"whatsapp-bot",
			phoneNumberId:
				opts.phoneNumberId?.trim() ||
				process.env.WHATSAPP_PHONE_NUMBER_ID?.trim(),
			accessToken:
				opts.accessToken?.trim() || process.env.WHATSAPP_ACCESS_TOKEN?.trim(),
			appSecret:
				opts.appSecret?.trim() || process.env.WHATSAPP_APP_SECRET?.trim(),
			verifyToken:
				opts.verifyToken?.trim() || process.env.WHATSAPP_VERIFY_TOKEN?.trim(),
			apiVersion: opts.apiVersion?.trim() || "v21.0",
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
	): WhatsAppConnectorState | undefined {
		return this.readStateFile(
			statePath,
			(value): value is WhatsAppConnectorState =>
				Boolean(
					value &&
						typeof value === "object" &&
						typeof (value as WhatsAppConnectorState).pid === "number" &&
						typeof (value as WhatsAppConnectorState).instanceKey === "string" &&
						typeof (value as WhatsAppConnectorState).userName === "string",
				),
		);
	}

	private writeConnectorState(
		statePath: string,
		state: WhatsAppConnectorState,
	): void {
		this.writeStateFile(statePath, state);
	}

	private async stopWhatsAppConnectorInstance(
		statePath: string,
		io: ConnectIo,
	): Promise<ConnectStopResult> {
		return this.stopManagedProcess({
			io,
			statePath,
			readState: (path) => this.readConnectorState(path),
			describeStoppedProcess: (state) =>
				`[whatsapp] stopped pid=${state.pid} user=${state.userName}${state.phoneNumberId ? ` phone=${state.phoneNumberId}` : ""}`,
			getPid: (state) => state.pid,
			stopSessions: stopSessionsForConnector,
			clearBindings: (state) => {
				clearBindingSessionIds<WhatsAppThreadState>(
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
				this.stopWhatsAppConnectorInstance(statePath, stopIo),
		);
	}

	protected override async runWithOptions(
		options: ConnectWhatsAppOptions,
		rawArgs: string[],
		io: ConnectIo,
	): Promise<number> {
		const instanceKey = resolveInstanceKey({
			phoneNumberId: options.phoneNumberId,
			userName: options.userName,
		});
		const statePath = this.resolveConnectorStatePath(instanceKey);
		const bindingsPath = this.resolveBindingsPath(instanceKey);
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
				childEnvVar: "CLINE_WHATSAPP_CONNECT_CHILD",
				statePath,
				readState: (path) => this.readConnectorState(path),
				isRunning: (state) => isProcessRunning(state.pid),
				formatAlreadyRunningMessage: (state) =>
					`[whatsapp] connector already running pid=${state.pid} rpc=${state.rpcAddress} url=${state.baseUrl}`,
				formatBackgroundStartMessage: (pid) =>
					`[whatsapp] starting background connector pid=${pid} user=${options.userName}`,
				foregroundHint:
					"[whatsapp] use `clite connect whatsapp -i ...` to run in the foreground",
				launchFailureMessage:
					"failed to launch WhatsApp connector in background",
			})
		) {
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
		const activeTurns = new Map<string, ActiveConnectorTurn>();
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

		const clientId = `whatsapp-${process.pid}-${Date.now()}`;
		const client = new HubSessionClient({
			address: rpcAddress,
			clientId,
			clientType: "cli",
			displayName: "whatsapp connector",
			workspaceRoot: startRequest.workspaceRoot || startRequest.cwd,
			cwd: startRequest.cwd,
			metadata: {
				transport: "whatsapp",
				userName: options.userName,
				...(options.phoneNumberId
					? { phoneNumberId: options.phoneNumberId }
					: {}),
			},
		});
		this.writeConnectorState(statePath, {
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
						transport: "whatsapp",
						botUserName: options.userName,
						requestStop,
						bindingsPath,
						hookCommand: options.hookCommand,
						systemRules: WHATSAPP_SYSTEM_RULES,
						errorLabel: "WhatsApp",
						firstContactMessage: WHATSAPP_FIRST_CONTACT_MESSAGE,
						userInstructionWatcher,
						chatCommandHost,
						activeTurns,
						turnKey: queueKey,
						getSessionMetadata: (currentThread, _clientId, currentState) => ({
							userName: options.userName,
							phoneNumberId: options.phoneNumberId,
							whatsappThreadId: currentThread.id,
							whatsappChannelId: currentThread.channelId,
							...(currentState.participantKey
								? { whatsappParticipantKey: currentState.participantKey }
								: {}),
							...(currentState.participantLabel
								? { whatsappParticipantLabel: currentState.participantLabel }
								: {}),
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
					const message =
						error instanceof Error ? error.message : String(error);
					await thread.post(`WhatsApp bridge error: ${message}`);
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
			await persistWhatsAppThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: message.raw,
				errorLabel: "WhatsApp",
			});
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
			await persistWhatsAppThreadContext({
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: message.raw,
				errorLabel: "WhatsApp",
			});
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
		userInstructionWatcher.stop();
		client.close();
		this.removeStateFile(statePath);
		return 0;
	}
}

export const whatsappConnector: ConnectCommandDefinition =
	new WhatsAppConnector();

export const __test__ = {
	findBindingForThread: (
		bindings: ConnectorBindingStore<WhatsAppThreadState>,
		thread: Pick<Thread<WhatsAppThreadState>, "id" | "channelId" | "isDM"> & {
			participantKey?: string;
		},
	) => findBindingForThread(bindings, thread),
};
