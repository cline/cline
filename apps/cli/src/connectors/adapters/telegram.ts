import {
	createTelegramAdapter,
	type TelegramRawMessage,
} from "@chat-adapter/telegram";
import type { ChatStartSessionRequest } from "@cline/core";
import {
	createUserInstructionConfigService,
	HubSessionClient,
} from "@cline/core";
import type {
	ConnectTelegramOptions,
	HubUINotifyAction,
	TelegramConnectorState,
} from "@cline/shared";
import { Chat, ConsoleLogger, type SentMessage, type Thread } from "chat";
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
import { buildCardAnchorText } from "../card-anchor";
import { parseNotifiedOptions, resolveCardAnswer } from "../card-answer";
import {
	buildClosingButtons,
	handleClosingTap,
	parseClosingActionId,
	readClosingConfirm,
	runClosingAction,
} from "../card-closing-actions";
import {
	buildAnsweredQuestionText,
	buildQuestionButtons,
	buildQuestionCard,
	type CardButton,
	formatQuestionBody,
	parseCardActionId,
} from "../card-question-message";
import { createChatSdkLogger, enqueueThreadTurn } from "../chat-runtime";
import { CONNECT_ALREADY_RUNNING_EXIT_CODE, isProcessRunning } from "../common";
import {
	type ActiveConnectorTurn,
	handleConnectorUserTurn,
	maybeHandleConnectorApprovalReply,
} from "../connector-host";
import { dispatchConnectorHook } from "../hooks";
import {
	answerKanbanCard,
	findRememberedCard,
	rememberCardMessage,
} from "../kanban-card-reply";
import {
	type MessageAttachmentLike,
	pruneOldImageDirs,
	saveMessageImages,
} from "../message-images";
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
	editTelegramCardMessage,
	postTelegramCardReply,
	resolveTelegramTopicId,
	splitTelegramMessageId,
} from "../telegram-card-reply";
import {
	type ConnectorBindingStore,
	type ConnectorThreadState,
	clearBindingSessionIds,
	findBindingForDeliveryTarget,
	findBindingForThread,
	loadThreadState,
	persistMergedThreadState,
	readBindings,
	resolveThreadBindingKey,
	resolveThreadTurnQueueKey,
	writeBindings,
} from "../thread-bindings";
import { collectThreadKeysToResubscribe } from "../thread-resubscription";
import type {
	ConnectCommandDefinition,
	ConnectIo,
	ConnectRunContext,
	ConnectStopResult,
} from "../types";
import {
	resolveNotifyMessageKey,
	shouldTrackForSuperseding,
} from "../ui-notify-delivery";
import { startUiNotifyDelivery } from "../ui-notify-subscription";
import {
	getConnectorFirstContactMessage,
	getConnectorSystemPrompt,
	getConnectorSystemRules,
} from "./prompts";
import { postTelegramFormattedReply } from "./telegram-format";
import {
	sendLongMessagesAsDocuments,
	splitLongCardNotice,
} from "./telegram-long-messages";

/** Pictures a command never used are removed after this long. */
const TASK_IMAGES_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const TELEGRAM_SYSTEM_RULES = getConnectorSystemRules("Telegram");

const TELEGRAM_FIRST_CONTACT_MESSAGE = getConnectorFirstContactMessage();
const TELEGRAM_API_BASE = "https://api.telegram.org";

type TelegramThreadState = ConnectorThreadState;
type ResolvedTelegramOptions = ConnectTelegramOptions & { botUsername: string };
type TelegramGetMeResponse = {
	ok?: boolean;
	description?: string;
	result?: {
		username?: string;
	};
};
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function truncateText(value: string, maxLength = 160): string {
	return truncateConnectorText(value, maxLength);
}

function normalizeTelegramBotUsername(value: string): string {
	return value.trim().replace(/^@+/, "");
}

function readTelegramBotId(botToken: string): string | undefined {
	const [botId] = botToken.trim().split(":", 1);
	return /^\d+$/.test(botId) ? botId : undefined;
}

function normalizeAllowedTelegramUserId(value: string): string {
	const userId = value.trim();
	if (!/^\d+$/.test(userId)) {
		throw new Error(
			"connect telegram --allowed-user-id must contain digits only",
		);
	}
	return userId;
}

function buildTelegramAllowedUserHookCommand(userId: string): string {
	return `jq -r ".payload.actor.participantKey" | grep -qx "telegram:id:${userId}" && echo '{"action":"allow"}' || echo '{"action":"deny","message":"unauthorized","reason":"not_on_allowlist"}'`;
}

function describeTelegramGetMeFailure(
	response: Response,
	body: string,
	parsed: TelegramGetMeResponse | undefined,
): string {
	const detail = parsed?.description || body.trim().slice(0, 240);
	return detail
		? `Telegram getMe failed (${response.status} ${response.statusText}): ${detail}`
		: `Telegram getMe failed (${response.status} ${response.statusText})`;
}

async function readTelegramGetMeResponse(
	response: Response,
): Promise<TelegramGetMeResponse> {
	const text = await response.text();
	let parsed: TelegramGetMeResponse;
	try {
		parsed = JSON.parse(text) as TelegramGetMeResponse;
	} catch {
		throw new Error(describeTelegramGetMeFailure(response, text, undefined));
	}
	if (!response.ok || parsed.ok !== true) {
		throw new Error(describeTelegramGetMeFailure(response, text, parsed));
	}
	return parsed;
}

async function fetchTelegramBotUsername(
	botToken: string,
	fetchImpl: FetchLike = fetch,
	apiBaseUrl = TELEGRAM_API_BASE,
): Promise<string> {
	const response = await fetchImpl(`${apiBaseUrl}/bot${botToken}/getMe`);
	const payload = await readTelegramGetMeResponse(response);
	const username = normalizeTelegramBotUsername(payload.result?.username ?? "");
	if (!username) {
		throw new Error(
			"Telegram getMe did not return a bot username; pass --bot-username explicitly",
		);
	}
	return username;
}

async function resolveTelegramBotUsername(
	options: ConnectTelegramOptions,
	fetchImpl?: FetchLike,
): Promise<string> {
	const configured = normalizeTelegramBotUsername(options.botUsername ?? "");
	if (configured) {
		return configured;
	}
	return fetchTelegramBotUsername(options.botToken, fetchImpl);
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
	if (userId) {
		return { key: `telegram:id:${userId}`, label };
	}
	if (username) {
		return { key: `telegram:user:${username}`, label };
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

type TelegramSlashCommandEvent = {
	channel: { id: string };
	command: string;
	text: string;
	raw: unknown;
};

/**
 * The Telegram chat adapter intercepts any message whose leading entity is a
 * `bot_command` and delivers it to slash-command handlers instead of the
 * normal mention/subscribed-message handlers. Without a registered handler
 * the command is consumed and dropped, so connector commands like /clear
 * never reach the chat command host. Rebuild the originating chat thread and
 * forward the original message text (preserving any `@bot` addressing used
 * in group chats) into the same turn pipeline as regular messages.
 */
function createTelegramSlashCommandHandler(input: {
	bot: Pick<Chat, "thread">;
	bindingsPath: string;
	baseStartRequest: ChatStartSessionRequest;
	handleTurn: (
		thread: Thread<TelegramThreadState>,
		text: string,
		incomingMessageId?: string,
		attachments?: readonly MessageAttachmentLike[],
	) => Promise<void>;
	/**
	 * The adapter's own reading of the raw message. A photo captioned `/task …` arrives here, not
	 * as an ordinary message, so this is the only place its picture can be picked up.
	 */
	parseMessage?: (
		raw: unknown,
	) =>
		| { id: string; attachments?: readonly MessageAttachmentLike[] }
		| undefined;
}): (event: TelegramSlashCommandEvent) => Promise<void> {
	return async (event) => {
		const raw = asRecord(event.raw);
		const commandText =
			readString(raw?.text) ??
			readString(raw?.caption) ??
			[event.command.trim(), event.text.trim()].filter(Boolean).join(" ");
		if (!commandText) {
			return;
		}
		const thread = input.bot.thread(
			event.channel.id,
		) as Thread<TelegramThreadState>;
		await thread.subscribe();
		await persistTelegramThreadContext({
			thread,
			bindingsPath: input.bindingsPath,
			baseStartRequest: input.baseStartRequest,
			rawMessage: event.raw,
			errorLabel: "Telegram",
		});
		const parsed = input.parseMessage?.(event.raw);
		if (!parsed) {
			await input.handleTurn(thread, commandText);
			return;
		}
		await input.handleTurn(thread, commandText, parsed.id, parsed.attachments);
	};
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
		typeof delivery.bindingKey === "string" ? delivery.bindingKey.trim() : "";
	const participantKey =
		typeof delivery.participantKey === "string"
			? delivery.participantKey.trim()
			: "";
	if (!threadId && !bindingKey && !participantKey) {
		return;
	}
	const bindings = readBindings<TelegramThreadState>(input.bindingsPath);
	const match = findBindingForDeliveryTarget(bindings, {
		bindingKey,
		threadId,
		participantKey,
	});
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
		await thread.post({ raw: body.trim() ? body : " " });
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
		return (
			super
				.createCommand()
				.usage("-k <TELEGRAM_BOT_TOKEN> [options]")
				.option(
					"-m, --bot-username <name>",
					"Telegram bot username; fetched from token if omitted",
				)
				.option("-k, --bot-token <token>", "Telegram bot token")
				.option("--provider <id>", "Provider override")
				.option("--model <id>", "Model override")
				.option("--api-key <key>", "Provider API key override")
				.option("--system <prompt>", "System prompt override")
				.option("--cwd <path>", "Workspace / cwd for runtime")
				.option("--mode <act|plan>", "Agent mode", "act")
				.option("-i, --interactive", "Keep connector in foreground")
				.option("--no-tools", "Disable tools for Telegram sessions")
				// Retained so existing invocations and persisted autostart arguments
				// keep parsing; tools are on unless --no-tools is passed.
				.option("--enable-tools", "Enable tools (default)")
				.option(
					"--allowed-user-id <id>",
					"Only allow this Telegram user ID to use the bot",
				)
				.option(
					"--hook-command <command>",
					"Run a shell command for connector events",
				)
				.option(
					"--rpc-address <host:port>",
					"RPC address",
					process.env.CLINE_RPC_ADDRESS?.trim() ||
						resolveDefaultCliRpcAddress(),
				)
				.addHelpText(
					"after",
					[
						"",
						"Notes:",
						"  - Without -i, the connector is launched in the background.",
						"  - Tools are enabled by default for Telegram sessions.",
						"  - Use --allowed-user-id or `cline connect` to restrict Telegram access.",
						"  - Bot username is discovered from the Telegram bot token when omitted.",
						"  - Provider/model default to the CLI's last-used provider settings.",
					].join("\n"),
				)
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
			tools?: boolean;
			rpcAddress?: string;
			hookCommand?: string;
			allowedUserId?: string;
		}>();
		const botUsername =
			normalizeTelegramBotUsername(opts.botUsername ?? "") ||
			normalizeTelegramBotUsername(
				process.env.TELEGRAM_BOT_USERNAME?.trim() ?? "",
			);
		const botToken =
			opts.botToken?.trim() || process.env.TELEGRAM_BOT_TOKEN?.trim();
		if (!botToken) {
			throw new Error("connect telegram requires -k/--bot-token <token>");
		}
		const hookCommand =
			opts.hookCommand?.trim() ||
			process.env.CLINE_CONNECT_HOOK_COMMAND?.trim();
		const allowedUserId = opts.allowedUserId?.trim();
		if (hookCommand && allowedUserId) {
			throw new Error(
				"connect telegram accepts either --allowed-user-id or --hook-command, not both",
			);
		}
		return {
			botToken,
			...(botUsername ? { botUsername } : {}),
			cwd: opts.cwd || process.cwd(),
			model: opts.model,
			provider: opts.provider,
			apiKey: opts.apiKey,
			systemPrompt: opts.system,
			mode: this.parseMode(opts.mode),
			interactive: Boolean(opts.interactive),
			enableTools: opts.tools !== false,
			rpcAddress:
				opts.rpcAddress?.trim() ||
				process.env.CLINE_RPC_ADDRESS?.trim() ||
				resolveDefaultCliRpcAddress(),
			hookCommand: allowedUserId
				? buildTelegramAllowedUserHookCommand(
						normalizeAllowedTelegramUserId(allowedUserId),
					)
				: hookCommand,
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

	private findRunningConnectorStateByBotId(
		botId: string | undefined,
	): TelegramConnectorState | undefined {
		if (!botId) {
			return undefined;
		}
		for (const statePath of this.listConnectorStatePaths()) {
			const state = this.readConnectorState(statePath);
			if (!state) {
				continue;
			}
			if (!isProcessRunning(state.pid)) {
				this.removeStateFile(statePath);
				continue;
			}
			if (state.botId === botId) {
				return state;
			}
		}
		return undefined;
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

	override async stopInstance(
		instanceId: string,
		io: ConnectIo,
	): Promise<ConnectStopResult> {
		return await this.stopTelegramConnectorInstance(
			this.resolveConnectorStatePath(instanceId),
			io,
		);
	}

	protected override async validateOptions(
		options: ConnectTelegramOptions,
		io: ConnectIo,
	): Promise<number> {
		try {
			await resolveTelegramBotUsername({
				...options,
				botUsername: undefined,
			});
			return 0;
		} catch (error) {
			io.writeErr(error instanceof Error ? error.message : String(error));
			return 1;
		}
	}

	/**
	 * Only knowable up front when `--bot-username` was supplied; otherwise the
	 * username is resolved from Telegram's API during startup, and the caller
	 * has to start this connector locally instead of through the hub.
	 */
	protected override instanceIdFromOptions(
		options: ConnectTelegramOptions,
	): string | undefined {
		return options.botUsername;
	}

	protected override async runWithOptions(
		inputOptions: ConnectTelegramOptions,
		rawArgs: string[],
		io: ConnectIo,
		context: ConnectRunContext,
	): Promise<number> {
		if (
			!inputOptions.botUsername &&
			!inputOptions.interactive &&
			process.env.CLINE_TELEGRAM_CONNECT_CHILD !== "1"
		) {
			const runningState = this.findRunningConnectorStateByBotId(
				readTelegramBotId(inputOptions.botToken),
			);
			if (runningState) {
				io.writeln(
					`[telegram] connector already running pid=${runningState.pid} rpc=${runningState.rpcAddress}`,
				);
				return CONNECT_ALREADY_RUNNING_EXIT_CODE;
			}
		}
		let resolvedBotUsername: string;
		try {
			resolvedBotUsername = await resolveTelegramBotUsername(inputOptions);
		} catch (error) {
			io.writeErr(error instanceof Error ? error.message : String(error));
			return 1;
		}
		const options: ResolvedTelegramOptions = {
			...inputOptions,
			botUsername: resolvedBotUsername,
		};
		const backgroundArgs = inputOptions.botUsername
			? rawArgs
			: [...rawArgs, "--bot-username", resolvedBotUsername];
		context.setPersistenceArgs(backgroundArgs);
		context.setPersistenceInstanceId(options.botUsername);
		const statePath = this.resolveConnectorStatePath(options.botUsername);
		const bindingsPath = this.resolveBindingsPath(options.botUsername);
		// Pictures a command saved and has not handed on yet: `/task --brainstorm` keeps them for
		// the agent. Anything a week old was never used.
		const taskImagesPath = this.resolveConnectorPath("task-images");
		void pruneOldImageDirs(taskImagesPath, TASK_IMAGES_MAX_AGE_MS);
		const staleState = this.removeStaleState(
			statePath,
			(path) => this.readConnectorState(path),
			(state) => state.pid,
		);
		if (staleState) {
			clearBindingSessionIds<TelegramThreadState>(bindingsPath);
		}
		const backgroundExitCode = await this.maybeRunInBackground({
			rawArgs: backgroundArgs,
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
				"[telegram] use `cline connect telegram -i ...` to run in the foreground",
			launchFailureMessage: "failed to launch Telegram connector in background",
		});
		if (backgroundExitCode !== undefined) {
			return backgroundExitCode;
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
		// The adapter cuts anything past 4096 characters; a long message goes out as a file.
		sendLongMessagesAsDocuments(telegram);
		const bot = new Chat({
			userName: options.botUsername,
			adapters: { telegram },
			state: new InMemoryStateAdapter(),
			logger,
			fallbackStreamingPlaceholderText: null,
			streamingUpdateIntervalMs: 500,
		}).registerSingleton();
		// Captured here because the notify callback shadows `options` with its own.
		const botToken = options.botToken;
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
		const userInstructionService = createUserInstructionConfigService({
			skills: { workspacePath: startRequest.cwd },
			rules: { workspacePath: startRequest.cwd },
			workflows: { workspacePath: startRequest.cwd },
		});
		await userInstructionService.start().catch(() => undefined);
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

		const clientId = `telegram-${process.pid}-${Date.now()}`;
		const client = new HubSessionClient({
			address: rpcAddress,
			authToken: rpcAuthToken,
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
		await client.connect();
		this.writeConnectorState(statePath, {
			botUsername: options.botUsername,
			botId: readTelegramBotId(options.botToken),
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

		// The hub has broadcast `ui.notify` for a while with only the menubar app listening.
		// Subscribing here is what makes a background completion -- a `--zen` run, a Kanban
		// card entering review -- reach the conversation it belongs to. Best-effort: a hub we
		// cannot reach is a normal condition and must never stop the connector from serving
		// chat, which is its actual job.
		// Subscriptions live in the chat library's in-memory state, so this restart forgot every
		// one of them. In a group that silences ordinary messages entirely -- including a reply
		// to something this bot posted -- with no log, until a slash command or a mention
		// happens to subscribe the thread again.
		for (const threadKey of collectThreadKeysToResubscribe(
			readBindings<TelegramThreadState>(bindingsPath),
		)) {
			try {
				const serialized =
					readBindings<TelegramThreadState>(bindingsPath)[threadKey]
						?.serializedThread;
				if (!serialized) {
					continue;
				}
				const thread = JSON.parse(
					serialized,
					bot.reviver(),
				) as Thread<TelegramThreadState>;
				await thread.subscribe();
			} catch (error) {
				loggerAdapter.core.log("Telegram thread resubscription failed", {
					severity: "warn",
					transport: "telegram",
					threadKey,
					error: String(error),
				});
			}
		}

		let notifySubscription:
			| Awaited<ReturnType<typeof startUiNotifyDelivery>>
			| undefined;
		// Lives only as long as the connector: after a restart the first update posts a new
		// message, which is the honest outcome -- the old one is no longer ours to touch.
		const notifyMessages = new Map<string, SentMessage>();
		// Closing taps still running, by message id: a second tap on a slow push is dropped.
		const closingInFlight = new Set<string>();
		// Questions awaiting a tap, by the id of the message carrying them. In memory only: a
		// question that outlives the process keeps its text in the bindings file, and the worst
		// case is a button that cannot be struck through, not an answer that is lost.
		const questionMessages = new Map<
			string,
			{
				text: string;
				edit: (next: string, buttons?: CardButton[]) => Promise<boolean>;
			}
		>();
		/**
		 * Remembers, on disk, which card each delivered notification belongs to, so a reply *to*
		 * that message can be carried back into the card's session. Telegram's own affordance is
		 * the signal; nothing is inferred from timing.
		 *
		 * On disk and not in a map because the first version used a map, and a connector restart
		 * between the question and the answer made the reply unrecognizable -- the answer then
		 * fell through to an ordinary chat turn, silently.
		 */
		const rememberCardFor = (
			threadKey: string,
			entry: {
				messageId: string;
				taskId: string;
				projectPath: string;
				options?: string[];
				actions?: HubUINotifyAction[];
				text?: string;
			},
		): void => {
			const bindings = readBindings<TelegramThreadState>(bindingsPath);
			const binding = bindings[threadKey];
			if (!binding) {
				return;
			}
			binding.cardMessages = rememberCardMessage(binding.cardMessages, entry);
			writeBindings(bindingsPath, bindings);
		};
		try {
			notifySubscription = await startUiNotifyDelivery<TelegramThreadState>({
				address: rpcAddress,
				authToken: rpcAuthToken,
				displayName: `telegram notifications (${options.botUsername})`,
				// Read fresh per event: bindings change while the connector runs.
				readBindings: () => readBindings<TelegramThreadState>(bindingsPath),
				deliver: async (threadKey, text, options) => {
					const bindings = readBindings<TelegramThreadState>(bindingsPath);
					const serialized = bindings[threadKey]?.serializedThread;
					if (!serialized) {
						// The workspace matched but the conversation has no thread to post into.
						// Worth a line: silence here is indistinguishable from "nothing matched".
						loggerAdapter.core.log(
							"Telegram notification has no thread to post to",
							{
								severity: "warn",
								transport: "telegram",
								threadKey,
							},
						);
						return;
					}
					const thread = JSON.parse(
						serialized,
						bot.reviver(),
					) as Thread<TelegramThreadState>;
					// A task reporting what it is doing sends one of these every few seconds.
					// Updating the message it already has keeps a working agent from becoming a
					// flood; a notification that asks for something never supersedes, so it
					// still arrives on its own.
					const messageKey = resolveNotifyMessageKey(threadKey, options.itemId);
					const previous = messageKey
						? notifyMessages.get(messageKey)
						: undefined;
					// A card dragged across the board has something to update and nothing to
					// announce: someone watching it already has it on screen, and someone who
					// never asked about that card should not be handed a message because a
					// board was tidied.
					if (options.updateOnly && !previous) {
						return;
					}
					// One message per card, edited for its whole life: the dot carries the
					// column, the line below carries what it is doing. Five unrelated messages
					// in a row was the thing nobody could read.
					const anchorText =
						options.itemId && options.title
							? buildCardAnchorText({
									title: options.title,
									taskId: options.itemId,
									column: options.column,
									detail: options.body,
								})
							: text;
					if (options.supersedesPrevious && previous) {
						try {
							const edited = await previous.edit({ raw: anchorText });
							notifyMessages.set(messageKey as string, edited);
							if (options.itemId && options.workspacePath) {
								// An edit keeps the message id, but re-registering costs nothing
								// and survives a transport that does not.
								rememberCardFor(threadKey, {
									messageId: edited.id,
									taskId: options.itemId,
									projectPath: options.workspacePath,
									options: parseNotifiedOptions(text),
								});
							}
							loggerAdapter.core.log("Telegram notification updated", {
								transport: "telegram",
								threadKey,
							});
							return;
						} catch {
							// Telegram refuses an edit whose text is unchanged, and refuses one
							// on a message too old to touch. Falling through to a new message is
							// better than losing the update.
							notifyMessages.delete(messageKey as string);
						}
					}
					// With choices, the question goes out as buttons: the answer is then a tap,
					// not a list to read and a number to type. `fallbackText` keeps the plain
					// version for anything that cannot render a card.
					// Choices only for a card that is waiting right now. A completed question
					// still carries its options in the text, and offering them again sends a tap
					// nowhere while looking, to the person, like being asked twice.
					const notifiedOptions = options.awaitingAnswer
						? parseNotifiedOptions(text)
						: [];
					// A finished card is offered what is still missing to close it instead; a card
					// that is asking gets only its question's choices, never both sets at once.
					const closingActions =
						!options.awaitingAnswer && options.itemId
							? (options.actions ?? [])
							: [];
					const buttons: CardButton[] = options.itemId
						? notifiedOptions.length > 0
							? buildQuestionButtons(options.itemId, notifiedOptions)
							: buildClosingButtons(options.itemId, closingActions)
						: [];
					// Anything that is not the running commentary names the card it belongs
					// to, so a conversation running several cards at once can be read. The
					// reference goes in before the card is built: a rendered card is what the
					// surface shows, and a line added only to the fallback is never seen.
					// The options are parsed from the text before it is cleaned: they are what
					// becomes the buttons, and with buttons on screen the written list is the
					// same choices twice.
					const questionText = formatQuestionBody(text, {
						hasChoices: notifiedOptions.length > 0,
					});
					let bodyText = options.supersedesPrevious ? anchorText : questionText;
					// A long notice -- a card's report, a long question -- would be cut. Its full
					// text goes first as a file; the notice keeps its opening, and with it the
					// buttons, the reply to the card and the edits that follow. The running
					// commentary is edited every few seconds and stays as it is.
					if (!options.supersedesPrevious) {
						const notice = splitLongCardNotice(bodyText, new Date());
						if (notice.document) {
							try {
								await thread.post(notice.document);
								bodyText = notice.text;
							} catch (error) {
								loggerAdapter.core.log(
									"Telegram notice file refused; sending the notice as it is",
									{
										severity: "warn",
										transport: "telegram",
										threadKey,
										error: String(error),
									},
								);
							}
						}
					}
					// A real reply, so the message links back to the card's own message. The
					// library cannot make one -- its Telegram adapter has no `reply` -- and a
					// tap is routed from the incoming update alone, so a message sent straight
					// to the Bot API is as answerable as one the library posted.
					const anchorRef =
						!options.supersedesPrevious && previous && options.itemId
							? splitTelegramMessageId(previous.id)
							: undefined;
					if (anchorRef && options.itemId) {
						const taskId = options.itemId;
						const replied = await postTelegramCardReply({
							botToken,
							request: {
								chatId: anchorRef.chatId,
								messageThreadId: resolveTelegramTopicId(threadKey),
								replyToMessageId: anchorRef.messageId,
								text: bodyText,
								buttons,
							},
						});
						if (replied) {
							if (buttons.length > 0) {
								questionMessages.set(replied.messageId, {
									text: bodyText,
									edit: (next, nextButtons) =>
										editTelegramCardMessage({
											botToken,
											messageRef: replied.messageId,
											text: next,
											buttons: nextButtons,
										}),
								});
							}
							if (options.workspacePath) {
								rememberCardFor(threadKey, {
									messageId: replied.messageId,
									taskId,
									projectPath: options.workspacePath,
									options: notifiedOptions,
									actions: closingActions,
									text: bodyText,
								});
							}
							loggerAdapter.core.log("Telegram notification delivered", {
								transport: "telegram",
								threadKey,
							});
							return;
						}
						// Telegram refused it; fall through and post through the library rather
						// than drop the message.
					}
					const card = buildQuestionCard({ text: bodyText, buttons });
					// Anything that is not the running commentary hangs off the anchor as a
					// reply, so the question, its answer and the review notice stay attached to
					// the card they belong to instead of scrolling away as loose messages.
					const sent = await (card
						? thread.post({ card, fallbackText: bodyText })
						: // Markdown, as the agent wrote it: the adapter renders it for Telegram.
							thread.post({ markdown: bodyText }));
					if (messageKey && shouldTrackForSuperseding(options)) {
						notifyMessages.set(messageKey, sent);
					}
					// Kept so the question can be rewritten once it is answered: editing it is
					// what clears the keyboard, and a live button on an answered question can
					// be tapped again with nowhere for the tap to go.
					if (card) {
						questionMessages.set(sent.id, {
							text: bodyText,
							edit: async (next, nextButtons) => {
								const nextCard =
									nextButtons && nextButtons.length > 0
										? buildQuestionCard({ text: next, buttons: nextButtons })
										: undefined;
								await sent.edit(
									nextCard
										? { card: nextCard, fallbackText: next }
										: { markdown: next },
								);
								return true;
							},
						});
					}
					if (options.itemId && options.workspacePath) {
						rememberCardFor(threadKey, {
							messageId: sent.id,
							taskId: options.itemId,
							projectPath: options.workspacePath,
							options: notifiedOptions,
							actions: closingActions,
							text: bodyText,
						});
					}
					loggerAdapter.core.log("Telegram notification delivered", {
						transport: "telegram",
						threadKey,
					});
				},
				onError: (error) => {
					loggerAdapter.core.log("Telegram notification delivery failed", {
						severity: "warn",
						transport: "telegram",
						error: String(error),
					});
				},
			});
		} catch (error) {
			loggerAdapter.core.log("Telegram notification subscription unavailable", {
				severity: "warn",
				transport: "telegram",
				error: String(error),
			});
		}

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
			/** Id of the message that started the turn, so a command can mark it as taken. */
			incomingMessageId?: string,
			/** What the message carried besides its text: a photo captioned `/task …`. */
			attachments?: readonly MessageAttachmentLike[],
		) => {
			const queueKey = resolveThreadTurnQueueKey(thread);
			const enqueueTurn = (work: () => Promise<void>) =>
				enqueueThreadTurn(threadQueues, queueKey, work);
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
							getConnectorSystemPrompt("Telegram"),
						clientId,
						logger: loggerAdapter,
						transport: "telegram",
						react: incomingMessageId
							? async (emoji) => {
									await telegram.addReaction(
										thread.id,
										incomingMessageId,
										emoji,
									);
								}
							: undefined,
						images:
							attachments && attachments.length > 0
								? () =>
										saveMessageImages({
											attachments,
											rootDir: taskImagesPath,
										})
								: undefined,
						botUserName: options.botUsername,
						requestStop,
						bindingsPath,
						hookCommand: options.hookCommand,
						systemRules: TELEGRAM_SYSTEM_RULES,
						errorLabel: "Telegram",
						firstContactMessage: TELEGRAM_FIRST_CONTACT_MESSAGE,
						userInstructionService,
						chatCommandHost,
						activeTurns,
						enqueueTurn,
						turnKey: queueKey,
						forceDisableTools: !options.enableTools,
						postFinalReply: async ({
							thread: currentThread,
							text: replyText,
						}) => {
							await postTelegramFormattedReply({
								thread: currentThread,
								text: replyText,
								botToken: options.botToken,
								logger: loggerAdapter,
							});
						},
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
					await thread.post({ raw: `Telegram bridge error: ${message}` });
				}
			};
			if (activeTurns.has(queueKey)) {
				await runTurn();
				return;
			}
			await enqueueTurn(runTurn);
		};

		/**
		 * A reply to a card's notification is an answer for that card's agent, not a new request
		 * for this connector. Replying to anything else is an ordinary message.
		 */
		const maybeAnswerCard = async (
			thread: Thread<TelegramThreadState>,
			message: { text: string; replyTo?: { id: string } },
		): Promise<boolean> => {
			const threadKey = resolveThreadBindingKey(thread);
			const card = findRememberedCard(
				readBindings<TelegramThreadState>(bindingsPath)[threadKey]
					?.cardMessages,
				message.replyTo?.id,
			);
			if (!card) {
				return false;
			}
			// The card's prompt may only accept a choice. Saying "passed it on" for an answer
			// that will be ignored is worse than saying nothing, so an answer that cannot be
			// placed comes back with the choices instead of travelling.
			const answer = resolveCardAnswer(message.text, card.options ?? []);
			if (answer.kind === "ask") {
				await thread.post({ raw: answer.message });
				return true;
			}
			const result = await answerKanbanCard(card, answer.text);
			await thread.post({ raw: result.message });
			loggerAdapter.core.log(
				result.ok
					? "Telegram card answer delivered"
					: "Telegram card answer refused",
				{
					...(result.ok ? {} : { severity: "warn" as const }),
					transport: "telegram",
					taskId: card.taskId,
				},
			);
			return true;
		};

		// A tap on one of our buttons is an answer for that card's agent. The button carries
		// which card and which choice, and the message it belongs to is remembered on disk, so
		// a restart between question and tap does not lose it.
		bot.onAction(async (event) => {
			// Closing a finished card: a tap runs a Kanban command instead of typing an answer
			// into the card's session.
			const closing = parseClosingActionId(event.actionId);
			if (closing) {
				const thread = event.thread as Thread<TelegramThreadState> | null;
				if (!thread) {
					return;
				}
				const threadKey = resolveThreadBindingKey(thread);
				const card = findRememberedCard(
					readBindings<TelegramThreadState>(bindingsPath)[threadKey]
						?.cardMessages,
					event.messageId,
				);
				await handleClosingTap({
					card,
					tap: closing,
					messageId: event.messageId,
					inFlight: closingInFlight,
					effects: {
						// Through the Bot API rather than the copy kept in memory, so a tap after a
						// restart can still rewrite its message.
						edit: (text, buttons) =>
							editTelegramCardMessage({
								botToken,
								messageRef: event.messageId,
								text,
								buttons,
							}),
						post: async (text) => {
							await thread.post({ raw: text });
						},
						run: async (action) => {
							const result = card
								? await runClosingAction(card, action)
								: { ok: false, message: "" };
							loggerAdapter.core.log(
								result.ok
									? "Telegram closing action ran"
									: "Telegram closing action refused",
								{
									...(result.ok ? {} : { severity: "warn" as const }),
									transport: "telegram",
									taskId: closing.taskId,
									action,
								},
							);
							return result;
						},
						readConfirm: () =>
							card ? readClosingConfirm(card) : Promise.resolve({ ok: false }),
					},
				});
				return;
			}
			const action = parseCardActionId(event.actionId);
			if (!action) {
				return;
			}
			const thread = event.thread as Thread<TelegramThreadState> | null;
			if (!thread) {
				return;
			}
			const threadKey = resolveThreadBindingKey(thread);
			const card = findRememberedCard(
				readBindings<TelegramThreadState>(bindingsPath)[threadKey]
					?.cardMessages,
				event.messageId,
			);
			if (!card || card.taskId !== action.taskId) {
				await thread.post({
					raw: "I no longer know which card that button belongs to.",
				});
				return;
			}
			const result = await answerKanbanCard(card, String(action.optionIndex));
			const chosen = card.options?.[action.optionIndex - 1];
			if (result.ok && chosen) {
				// The question stops being a question: struck through with what was picked, and
				// edited -- which is what removes the keyboard. Reported from use: "I can click
				// several times because the button stays active and there is no indication it
				// was answered."
				const asked = questionMessages.get(event.messageId);
				if (asked) {
					try {
						await asked.edit(buildAnsweredQuestionText(asked.text, chosen));
						questionMessages.delete(event.messageId);
					} catch {
						// An edit can be refused on a message too old to touch. The question
						// then keeps its buttons; answering again is refused by the card.
					}
				}
				// No separate line for the choice: the question now shows it, and a second
				// message saying the same thing is the noise this set out to remove.
			} else {
				await thread.post({ raw: result.message });
			}
			loggerAdapter.core.log(
				result.ok
					? "Telegram card button delivered"
					: "Telegram card button refused",
				{
					...(result.ok ? {} : { severity: "warn" as const }),
					transport: "telegram",
					taskId: card.taskId,
				},
			);
		});

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
					transport: "telegram",
				})
			) {
				return;
			}
			if (await maybeAnswerCard(thread, message)) {
				return;
			}
			await handleTurn(thread, message.text, message.id, message.attachments);
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
					transport: "telegram",
				})
			) {
				return;
			}
			if (await maybeAnswerCard(thread, message)) {
				return;
			}
			await handleTurn(thread, message.text, message.id, message.attachments);
		});

		bot.onSlashCommand(
			createTelegramSlashCommandHandler({
				bot,
				bindingsPath,
				baseStartRequest: startRequest,
				handleTurn,
				parseMessage: (raw) => {
					try {
						return telegram.parseMessage(raw as TelegramRawMessage);
					} catch {
						// A payload the adapter cannot read still runs as the command it says.
						return undefined;
					}
				},
			}),
		);

		await bot.initialize();
		const stopTaskUpdateStream =
			startConnectorTaskUpdateRelay<TelegramThreadState>({
				client,
				clientId,
				bot,
				logger: loggerAdapter,
				bindingsPath,
				transport: "telegram",
				postToThread: async ({ thread, body }) => {
					await thread.post({ raw: body.trim() ? body : " " });
				},
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
					if (
						event.eventType !== "schedule.execution.completed" &&
						event.eventType !== "schedule.execution.failed"
					) {
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
		clearBindingSessionIds<TelegramThreadState>(bindingsPath);

		stopTaskUpdateStream();
		stopEventStream();
		userInstructionService.stop();
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
		await notifySubscription?.stop().catch(() => undefined);
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
	createTelegramSlashCommandHandler,
	fetchTelegramBotUsername,
	readTelegramBotId,
	resolveTelegramBotUsername,
	resolveTelegramParticipant,
	findBindingForThread: (
		bindings: ConnectorBindingStore<TelegramThreadState>,
		thread: Pick<Thread<TelegramThreadState>, "id" | "channelId" | "isDM"> & {
			participantKey?: string;
		},
	) => findBindingForThread(bindings, thread),
};
