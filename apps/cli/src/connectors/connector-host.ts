import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type {
	ChatRunTurnRequest,
	ChatStartSessionRequest,
	HubSessionClient,
	UserInstructionConfigService,
} from "@cline/core";
import { isUnusableSessionError } from "@cline/core";
import type { GeneratedMedia } from "@cline/shared";
import type { SentMessage, Thread } from "chat";
import type { CliLoggerAdapter } from "../logging/adapter";
import { buildUserInputMessage, resolveSystemPrompt } from "../runtime/prompt";
import {
	type ChatCommandHost,
	type ChatCommandState,
	isCommandAddressedToBot,
	type MuteCommandInput,
	maybeHandleChatCommand,
	normalizeCommandName,
} from "../utils/chat-commands";
import { authorizeConnectorEvent, dispatchConnectorHook } from "./hooks";
import {
	createConnectorRuntimeTurnStream,
	formatConnectorApprovalPrompt,
	type PendingConnectorApproval,
	parseConnectorApprovalDecision,
	truncateConnectorText,
} from "./runtime-turn";
import {
	buildThreadStartRequest,
	clearSession,
	forgetThreadSession,
	getOrCreateSessionId,
} from "./session-runtime";
import {
	type ConnectorMuteTarget,
	type ConnectorThreadState,
	findMutedParticipantsForThread,
	isParticipantMutedInBindings,
	isThreadMutedInBindings,
	loadThreadState,
	persistMergedThreadState,
	persistThreadBinding,
	readBindings,
	resolveThreadBindingKey,
	setParticipantMuted,
	setThreadMuted,
} from "./thread-bindings";

export type ActiveConnectorTurn = {
	sessionId: string;
	threadId?: string;
	participantKey?: string;
};

type ConnectorTurnQueue = (work: () => Promise<void>) => Promise<void>;

type ConnectorTurnCoordination =
	| {
			activeTurns: Map<string, ActiveConnectorTurn>;
			enqueueTurn: ConnectorTurnQueue;
			turnKey?: string;
	  }
	| {
			activeTurns?: undefined;
			enqueueTurn?: undefined;
			turnKey?: string;
	  };

type EmptyRuntimeReplyResolver = () => Promise<string | undefined>;

type EmptyRuntimeReplyResolverFactory = (input: {
	client: HubSessionClient;
	sessionId: string;
}) =>
	| Promise<EmptyRuntimeReplyResolver | undefined>
	| EmptyRuntimeReplyResolver
	| undefined;

function connectorTextPayload(
	transport: string,
	text: string,
): string | { raw: string } {
	const body = text.trim() ? text : " ";
	return transport === "telegram" ? { raw: body } : body;
}

async function postConnectorText<TState extends ConnectorThreadState>(
	thread: Thread<TState>,
	transport: string,
	text: string,
): Promise<SentMessage> {
	return await thread.post(connectorTextPayload(transport, text));
}

async function editConnectorText(
	message: SentMessage,
	transport: string,
	text: string,
): Promise<SentMessage> {
	return await message.edit(connectorTextPayload(transport, text));
}

function buildAttachments(input: {
	userImages: string[];
	userFiles: string[];
}): ChatRunTurnRequest["attachments"] | undefined {
	const userImages = input.userImages.length > 0 ? input.userImages : undefined;
	const userFiles =
		input.userFiles.length > 0
			? input.userFiles.map((filePath) => ({
					name: basename(filePath),
					content: readFileSync(filePath, "utf8"),
				}))
			: undefined;
	if (!userImages && !userFiles) {
		return undefined;
	}
	return { userImages, userFiles };
}

async function postConnectorRuntimeReply<TState extends ConnectorThreadState>(
	thread: Thread<TState>,
	transport: string,
	stream: AsyncIterable<string>,
	postFinalReply?: (text: string) => Promise<void>,
	resolveFallbackText?: () => Promise<string | undefined>,
	hasNonTextReply?: () => boolean,
): Promise<void> {
	if (transport !== "telegram" && !postFinalReply && !resolveFallbackText) {
		await thread.post(stream);
		return;
	}

	let text = "";
	for await (const chunk of stream) {
		text += chunk;
	}
	if (!text.trim() && hasNonTextReply?.()) {
		return;
	}
	if (!text.trim()) {
		text = (await resolveFallbackText?.())?.trim() || "";
	}
	if (isConnectorIdleReply(text)) {
		return;
	}
	if (resolveFallbackText && !text.trim()) {
		throw new Error("Runtime completed without assistant reply text.");
	}
	if (postFinalReply) {
		await postFinalReply(text);
		return;
	}
	await postConnectorText(thread, transport, text);
}

const CONNECTOR_MEDIA_EXTENSIONS: Readonly<Record<string, string>> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"audio/mpeg": "mp3",
	"audio/wav": "wav",
	"audio/ogg": "ogg",
	"video/mp4": "mp4",
	"video/webm": "webm",
};

async function postConnectorGeneratedMedia<TState extends ConnectorThreadState>(
	thread: Thread<TState>,
	mediaItems: readonly GeneratedMedia[],
): Promise<void> {
	if (mediaItems.length === 0) {
		return;
	}

	const files: Array<{ data: Buffer; filename: string; mimeType: string }> = [];
	const references: string[] = [];
	for (const [index, media] of mediaItems.entries()) {
		const label = media.name?.trim() || `Generated ${media.modality}`;
		switch (media.source.type) {
			case "base64": {
				const data = Buffer.from(media.source.data, "base64");
				if (data.byteLength === 0) {
					references.push(
						`${label} (${media.mediaType}) could not be attached.`,
					);
					break;
				}
				const extension =
					CONNECTOR_MEDIA_EXTENSIONS[media.mediaType.toLowerCase()] ?? "bin";
				const suppliedName = media.name ? basename(media.name) : "";
				files.push({
					data,
					filename: suppliedName || `generated-${index + 1}.${extension}`,
					mimeType: media.mediaType,
				});
				break;
			}
			case "url":
				references.push(`[${label}](${media.source.url})`);
				break;
			case "artifact":
				references.push(`${label}: artifact ${media.source.artifactId}`);
				break;
		}
	}

	if (files.length === 0 && references.length === 0) {
		return;
	}
	await thread.post({
		markdown: references.length > 0 ? references.join("\n") : "Generated media",
		...(files.length > 0 ? { files } : {}),
	});
}

/**
 * Clears a thread's stale session mapping after the hub reported the mapped
 * session no longer exists, so the next turn starts a fresh session instead of
 * failing forever against a dead session id.
 */
async function forgetStaleThreadSession<
	TState extends ConnectorThreadState,
>(input: {
	thread: Thread<TState>;
	bindingsPath: string;
	baseStartRequest: ChatStartSessionRequest;
	errorLabel: string;
	logger: CliLoggerAdapter;
	transport: string;
	sessionId: string;
}): Promise<boolean> {
	const forgotten = await forgetThreadSession({
		thread: input.thread,
		bindingsPath: input.bindingsPath,
		baseStartRequest: input.baseStartRequest,
		errorLabel: input.errorLabel,
		expectedSessionId: input.sessionId,
	});
	if (!forgotten) {
		return false;
	}
	input.logger.core.log(
		"Connector thread session no longer exists; starting a new session",
		{
			severity: "warn",
			transport: input.transport,
			threadId: input.thread.id,
			channelId: input.thread.channelId,
			sessionId: input.sessionId,
		},
	);
	return true;
}

function applyForcedToolDisable<TState extends ConnectorThreadState>(
	state: TState,
	forceDisableTools: boolean | undefined,
): TState {
	if (!forceDisableTools) {
		return state;
	}
	return {
		...state,
		enableTools: false,
		autoApproveTools: false,
	};
}

export function isConnectorIdleReply(text: string): boolean {
	return text.trim().toLowerCase() === "/idle";
}

function resolveConnectorCommandName(
	text: string,
	botUserName: string | undefined,
): string | undefined {
	const [commandToken = ""] = text.trim().split(/\s+/);
	if (!commandToken.startsWith("/")) {
		return undefined;
	}
	return normalizeCommandName(commandToken.toLowerCase(), botUserName);
}

function getConnectorCommandToken(text: string): string | undefined {
	const [commandToken = ""] = text.trim().split(/\s+/);
	return commandToken.startsWith("/") ? commandToken : undefined;
}

function isConnectorCommandAddressedToThisBot(
	text: string,
	botUserName: string | undefined,
): boolean {
	const commandToken = getConnectorCommandToken(text);
	return commandToken
		? isCommandAddressedToBot(commandToken, botUserName)
		: false;
}

function participantMatchesOwner(
	participantKey: string | undefined,
	ownerParticipantKeys: readonly string[] | undefined,
): boolean {
	const normalizedParticipantKey = participantKey?.trim().toLowerCase();
	if (!normalizedParticipantKey) {
		return false;
	}
	return (ownerParticipantKeys ?? []).some(
		(key) => key.trim().toLowerCase() === normalizedParticipantKey,
	);
}

function formatMuteTargetLabel(target: ConnectorMuteTarget): string {
	return target.participantLabel?.trim() || target.participantKey;
}

function formatMuteTargetList(targets: ConnectorMuteTarget[]): string {
	return targets.map(formatMuteTargetLabel).join(", ");
}

type ConnectorUserTurnInput<TState extends ConnectorThreadState> = {
	thread: Thread<TState>;
	text: string;
	runtimeText?: string;
	client: HubSessionClient;
	pendingApprovals: Map<string, PendingConnectorApproval>;
	baseStartRequest: ChatStartSessionRequest;
	explicitSystemPrompt: string | undefined;
	clientId: string;
	logger: CliLoggerAdapter;
	transport: string;
	botUserName?: string;
	ownerParticipantKeys?: string[];
	requestStop: (reason: string) => void;
	bindingsPath: string;
	hookCommand?: string;
	systemRules: string;
	errorLabel: string;
	getSessionMetadata: (
		thread: Thread<TState>,
		clientId: string,
		currentState: TState,
	) => Record<string, unknown>;
	getScheduleDeliveryMetadata?: (
		thread: Thread<TState>,
	) => Record<string, unknown>;
	firstContactMessage?: string | ((currentState: TState) => string | undefined);
	chatCommandHost?: ChatCommandHost;
	userInstructionService?: UserInstructionConfigService;
	resolveMuteTarget?: (input: {
		target: string;
		thread: Thread<TState>;
		currentState: TState;
	}) =>
		| Promise<ConnectorMuteTarget | undefined>
		| ConnectorMuteTarget
		| undefined;
	forceDisableTools?: boolean;
	reusedLogMessage: string;
	startedLogMessage?: string;
	messageReceivedLogMessage?: string;
	threadResetLogMessage?: string;
	connectorStopLogMessage?: string;
	onMessageReceived?: (details: {
		threadId: string;
		channelId: string;
		isDM: boolean;
		textLength: number;
		textPreview: string;
	}) => Promise<void>;
	onDescribe?: (
		currentState: TState,
		baseStartRequest: ChatStartSessionRequest,
		thread: Thread<TState>,
	) => Promise<string> | string;
	postFinalReply?: (input: {
		thread: Thread<TState>;
		text: string;
	}) => Promise<void>;
	createEmptyRuntimeReplyResolver?: EmptyRuntimeReplyResolverFactory;
	onReplyCompleted?: (result: {
		sessionId: string;
		threadId: string;
		text: string;
		finishReason?: string;
		iterations?: number;
	}) => Promise<void>;
	onReplyFailed?: (details: {
		sessionId: string;
		threadId: string;
		error: Error;
	}) => Promise<void>;
} & ConnectorTurnCoordination;

export async function handleConnectorUserTurn<
	TState extends ConnectorThreadState,
>(input: ConnectorUserTurnInput<TState>): Promise<void> {
	const resolvedInput = input.text.trim();
	if (!resolvedInput) {
		return;
	}
	const runtimeInput = input.runtimeText?.trim() || resolvedInput;

	const initialState = await loadThreadState(
		input.thread,
		input.bindingsPath,
		input.baseStartRequest,
	);
	const authorization = await authorizeConnectorEvent(
		input.hookCommand,
		{
			adapter: input.transport,
			botUserName: input.botUserName,
			request: {
				actor: {
					id: initialState.participantKey || undefined,
					label: initialState.participantLabel || undefined,
					participantKey: initialState.participantKey || undefined,
					participantLabel: initialState.participantLabel || undefined,
				},
				context: {
					source: input.transport,
					sourceEvent: "message.received",
					threadId: input.thread.id,
					channelId: input.thread.channelId,
					isDM: input.thread.isDM,
					sessionId: initialState.sessionId || undefined,
					workspaceRoot:
						initialState.workspaceRoot || input.baseStartRequest.workspaceRoot,
					metadata: {
						botUserName: input.botUserName,
					},
				},
				payload: {
					text: resolvedInput,
					textLength: resolvedInput.length,
					textPreview: truncateConnectorText(resolvedInput),
				},
			},
		},
		input.logger,
	);
	if (authorization.action === "deny") {
		const denialMessage =
			authorization.message?.trim() ||
			"You are not authorized to use this bot.";
		await postConnectorText(input.thread, input.transport, denialMessage);
		await dispatchConnectorHook(
			input.hookCommand,
			{
				adapter: input.transport,
				botUserName: input.botUserName,
				event: "message.denied",
				payload: {
					threadId: input.thread.id,
					channelId: input.thread.channelId,
					isDM: input.thread.isDM,
					participantKey: initialState.participantKey,
					participantLabel: initialState.participantLabel,
					reason: authorization.reason,
					message: denialMessage,
				},
				ts: new Date().toISOString(),
			},
			input.logger,
		);
		input.logger.core.log(
			"Inbound connector event denied by authorization hook",
			{
				transport: input.transport,
				threadId: input.thread.id,
				channelId: input.thread.channelId,
				participantKey: initialState.participantKey,
				reason: authorization.reason,
			},
		);
		return;
	}
	const commandName = resolveConnectorCommandName(
		resolvedInput,
		input.botUserName,
	);
	const isConnectorCommand = commandName !== undefined;
	if (
		isConnectorCommand &&
		!input.thread.isDM &&
		!isConnectorCommandAddressedToThisBot(resolvedInput, input.botUserName)
	) {
		input.logger.core.log("Unaddressed connector chat command ignored", {
			transport: input.transport,
			threadId: input.thread.id,
			channelId: input.thread.channelId,
			participantKey: initialState.participantKey,
			textPreview: truncateConnectorText(resolvedInput),
		});
		return;
	}
	if (
		isConnectorCommand &&
		input.ownerParticipantKeys?.length &&
		!participantMatchesOwner(
			initialState.participantKey,
			input.ownerParticipantKeys,
		)
	) {
		await postConnectorText(
			input.thread,
			input.transport,
			"Only the connector owner can use slash commands.",
		);
		input.logger.core.log("Non-owner connector chat command denied", {
			transport: input.transport,
			threadId: input.thread.id,
			channelId: input.thread.channelId,
			participantKey: initialState.participantKey,
			ownerParticipantKeys: input.ownerParticipantKeys,
			textPreview: truncateConnectorText(resolvedInput),
		});
		return;
	}
	const turnBindings = readBindings<TState>(input.bindingsPath);
	const threadMuted = isThreadMutedInBindings(turnBindings, input.thread);
	const participantMuted = isParticipantMutedInBindings(
		turnBindings,
		input.thread,
		initialState.participantKey,
	);
	if (
		(threadMuted || participantMuted) &&
		commandName !== "/unmute" &&
		commandName !== "/mute"
	) {
		input.logger.core.log("Muted connector thread message ignored", {
			transport: input.transport,
			threadId: input.thread.id,
			channelId: input.thread.channelId,
			participantKey: initialState.participantKey,
			muteScope: threadMuted ? "thread" : "participant",
			textPreview: truncateConnectorText(resolvedInput),
		});
		return;
	}
	const turnKey =
		input.turnKey ||
		resolveThreadBindingKey(
			{
				id: input.thread.id,
				channelId: input.thread.channelId,
				isDM: input.thread.isDM,
				participantKey: initialState.participantKey,
			},
			initialState,
		);
	const firstContactMessage =
		typeof input.firstContactMessage === "function"
			? input.firstContactMessage(initialState)
			: input.firstContactMessage;
	let initialStateChanged = false;
	if (!initialState.welcomeSentAt && firstContactMessage?.trim()) {
		await postConnectorText(
			input.thread,
			input.transport,
			firstContactMessage.trim(),
		);
		initialState.welcomeSentAt = new Date().toISOString();
		initialStateChanged = true;
	}
	if (initialStateChanged) {
		await persistMergedThreadState(
			input.thread,
			input.bindingsPath,
			initialState,
			input.errorLabel,
		);
	} else {
		persistThreadBinding(
			input.bindingsPath,
			input.thread,
			initialState,
			input.errorLabel,
		);
	}

	const textPreview = truncateConnectorText(resolvedInput);
	const receivedDetails = {
		threadId: input.thread.id,
		channelId: input.thread.channelId,
		isDM: input.thread.isDM,
		textLength: resolvedInput.length,
		textPreview,
	};
	if (input.messageReceivedLogMessage) {
		input.logger.core.log(input.messageReceivedLogMessage, {
			transport: input.transport,
			...receivedDetails,
		});
	}
	await input.onMessageReceived?.(receivedDetails);

	const toolLockCommand = commandName?.match(/^\/(tools|yolo)$/i);
	if (input.forceDisableTools && toolLockCommand) {
		const settingName = toolLockCommand[1]?.toLowerCase();
		await postConnectorText(
			input.thread,
			input.transport,
			`${settingName}=off (disabled by connector startup)`,
		);
		return;
	}

	if (
		await maybeHandleChatCommand(resolvedInput, {
			enabled: true,
			botUserName: input.botUserName,
			requireBotMention: !input.thread.isDM,
			host: input.chatCommandHost,
			getState: async () => {
				const current = await loadThreadState(
					input.thread,
					input.bindingsPath,
					input.baseStartRequest,
				);
				const effectiveCurrent = applyForcedToolDisable(
					current,
					input.forceDisableTools,
				);
				return {
					enableTools:
						effectiveCurrent.enableTools ?? input.baseStartRequest.enableTools,
					autoApproveTools:
						effectiveCurrent.autoApproveTools ??
						input.baseStartRequest.autoApproveTools === true,
					cwd:
						effectiveCurrent.cwd ||
						input.baseStartRequest.cwd ||
						input.baseStartRequest.workspaceRoot,
					workspaceRoot:
						effectiveCurrent.workspaceRoot ||
						input.baseStartRequest.workspaceRoot,
					toolsLocked: input.forceDisableTools,
					threadMuted: isThreadMutedInBindings(turnBindings, input.thread),
				};
			},
			setState: async (next: ChatCommandState) => {
				const currentState = await loadThreadState(
					input.thread,
					input.bindingsPath,
					input.baseStartRequest,
				);
				const systemPrompt = await resolveSystemPrompt({
					cwd: next.cwd,
					explicitSystemPrompt: input.explicitSystemPrompt,
					providerId: input.baseStartRequest.provider,
					rules: input.systemRules,
				});
				const nextState = {
					...currentState,
					enableTools: input.forceDisableTools ? false : next.enableTools,
					autoApproveTools: input.forceDisableTools
						? false
						: next.autoApproveTools,
					cwd: next.cwd,
					workspaceRoot: next.workspaceRoot,
					systemPrompt,
				};
				const effectiveCurrent = applyForcedToolDisable(
					currentState,
					input.forceDisableTools,
				);
				const runtimeConfigChanged =
					(effectiveCurrent.enableTools ??
						input.baseStartRequest.enableTools) !== nextState.enableTools ||
					(effectiveCurrent.autoApproveTools ??
						input.baseStartRequest.autoApproveTools === true) !==
						nextState.autoApproveTools ||
					(effectiveCurrent.cwd || input.baseStartRequest.cwd) !== next.cwd ||
					(effectiveCurrent.workspaceRoot ||
						input.baseStartRequest.workspaceRoot) !== next.workspaceRoot ||
					(effectiveCurrent.systemPrompt ||
						input.baseStartRequest.systemPrompt) !== systemPrompt;
				if (runtimeConfigChanged && currentState.sessionId?.trim()) {
					await clearSession({
						thread: input.thread,
						client: input.client,
						bindingsPath: input.bindingsPath,
						baseStartRequest: input.baseStartRequest,
						errorLabel: input.errorLabel,
					});
					nextState.sessionId = undefined;
				}
				await persistMergedThreadState(
					input.thread,
					input.bindingsPath,
					nextState as TState,
					input.errorLabel,
				);
			},
			reply: async (message) => {
				await postConnectorText(input.thread, input.transport, message);
			},
			reset: async () => {
				await clearSession({
					thread: input.thread,
					client: input.client,
					bindingsPath: input.bindingsPath,
					baseStartRequest: input.baseStartRequest,
					errorLabel: input.errorLabel,
				});
				if (input.threadResetLogMessage) {
					input.logger.core.log(input.threadResetLogMessage, {
						transport: input.transport,
						threadId: input.thread.id,
					});
				}
				await dispatchConnectorHook(
					input.hookCommand,
					{
						adapter: input.transport,
						botUserName: input.botUserName,
						event: "session.reset",
						payload: {
							threadId: input.thread.id,
							channelId: input.thread.channelId,
						},
						ts: new Date().toISOString(),
					},
					input.logger,
				);
			},
			abort: async () => {
				const activeTurn = input.activeTurns?.get(turnKey);
				if (!activeTurn?.sessionId?.trim()) {
					await postConnectorText(
						input.thread,
						input.transport,
						"No active task to abort.",
					);
					return;
				}
				await input.client.abortRuntimeSession(activeTurn.sessionId);
				await postConnectorText(
					input.thread,
					input.transport,
					"Aborting current task.",
				);
			},
			mute: async (commandInput: MuteCommandInput) => {
				const target = commandInput.target?.trim()
					? await input.resolveMuteTarget?.({
							target: commandInput.target,
							thread: input.thread,
							currentState: initialState,
						})
					: undefined;
				if (commandInput.target?.trim() && !target) {
					return `Could not resolve mute target: ${commandInput.target.trim()}`;
				}
				const activeTurns = input.activeTurns
					? Array.from(input.activeTurns.entries()).filter(([key, turn]) =>
							target
								? key === target.participantKey ||
									turn.participantKey === target.participantKey
								: key === turnKey ||
									turn.threadId === input.thread.id ||
									(initialState.sessionId?.trim() &&
										turn.sessionId === initialState.sessionId.trim()),
						)
					: [];
				await Promise.allSettled(
					activeTurns.map(([, turn]) =>
						input.client.abortRuntimeSession(turn.sessionId),
					),
				);
				if (target) {
					setParticipantMuted(
						input.bindingsPath,
						input.thread,
						target,
						true,
						input.errorLabel,
					);
					return `Muted ${formatMuteTargetLabel(target)} in this thread. I will ignore their messages until /unmute ${formatMuteTargetLabel(target)}.`;
				}
				setThreadMuted(
					input.bindingsPath,
					input.thread,
					true,
					input.errorLabel,
				);
				return undefined;
			},
			unmute: async (commandInput: MuteCommandInput) => {
				const target = commandInput.target?.trim()
					? await input.resolveMuteTarget?.({
							target: commandInput.target,
							thread: input.thread,
							currentState: initialState,
						})
					: undefined;
				if (commandInput.target?.trim() && !target) {
					return `Could not resolve unmute target: ${commandInput.target.trim()}`;
				}
				if (target) {
					setParticipantMuted(
						input.bindingsPath,
						input.thread,
						target,
						false,
						input.errorLabel,
					);
					return `Unmuted ${formatMuteTargetLabel(target)} in this thread.`;
				}
				if (!threadMuted) {
					const mutedParticipants = findMutedParticipantsForThread(
						turnBindings,
						input.thread,
					);
					if (mutedParticipants.length > 0) {
						return `No thread-level mute is active. Participant-specific mutes are still active for ${formatMuteTargetList(mutedParticipants)}. Use /unmute <target> to clear one.`;
					}
					return "Thread is not muted.";
				}
				setThreadMuted(
					input.bindingsPath,
					input.thread,
					false,
					input.errorLabel,
				);
				return undefined;
			},
			stop: async () => {
				await clearSession({
					thread: input.thread,
					client: input.client,
					bindingsPath: input.bindingsPath,
					baseStartRequest: input.baseStartRequest,
					errorLabel: input.errorLabel,
				});
				if (input.connectorStopLogMessage) {
					input.logger.core.log(input.connectorStopLogMessage, {
						severity: "warn",
						transport: input.transport,
						threadId: input.thread.id,
					});
				}
				input.requestStop(`${input.transport}_stop_command`);
			},
			describe: async () => {
				const current = await loadThreadState(
					input.thread,
					input.bindingsPath,
					input.baseStartRequest,
				);
				const effectiveCurrent = applyForcedToolDisable(
					current,
					input.forceDisableTools,
				);
				if (input.onDescribe) {
					return input.onDescribe(
						effectiveCurrent,
						input.baseStartRequest,
						input.thread,
					);
				}
				return [
					`threadId=${input.thread.id}`,
					`channelId=${input.thread.channelId}`,
					`deliveryAdapter=${input.transport}`,
					`deliveryThread=${input.thread.id}`,
					`deliveryBindingKey=${input.thread.id}`,
					`deliveryChannel=${input.thread.channelId}`,
					...(input.botUserName
						? [`deliveryUserName=${input.botUserName}`]
						: []),
					...(effectiveCurrent.participantLabel
						? [`participant=${effectiveCurrent.participantLabel}`]
						: []),
					...(effectiveCurrent.participantKey
						? [`participantKey=${effectiveCurrent.participantKey}`]
						: []),
					`isDM=${input.thread.isDM ? "true" : "false"}`,
					`tools=${effectiveCurrent.enableTools ? "on" : "off"}`,
					`yolo=${effectiveCurrent.autoApproveTools ? "on" : "off"}`,
					`muted=${threadMuted ? "true" : "false"}`,
					`cwd=${effectiveCurrent.cwd || input.baseStartRequest.cwd}`,
					`workspaceRoot=${effectiveCurrent.workspaceRoot || input.baseStartRequest.workspaceRoot}`,
				].join("\n");
			},
			schedule: {
				create: async ({ name, cronPattern, prompt }) => {
					const current = await loadThreadState(
						input.thread,
						input.bindingsPath,
						input.baseStartRequest,
					);
					const effectiveCurrent = applyForcedToolDisable(
						current,
						input.forceDisableTools,
					);
					const config = buildThreadStartRequest(
						input.baseStartRequest,
						effectiveCurrent,
					);
					const metadata = {
						delivery: {
							adapter: input.transport,
							threadId: input.thread.id,
							bindingKey: input.thread.id,
							...(current.participantKey
								? { participantKey: current.participantKey }
								: {}),
							...(current.participantLabel
								? { participantLabel: current.participantLabel }
								: {}),
							channelId: input.thread.channelId,
							...(input.botUserName ? { userName: input.botUserName } : {}),
							...(input.getScheduleDeliveryMetadata?.(input.thread) ?? {}),
						},
					};
					const created = await input.client.createSchedule({
						name,
						cronPattern,
						prompt,
						provider: config.provider,
						model: config.model,
						mode: config.mode,
						workspaceRoot: config.workspaceRoot,
						cwd: config.cwd,
						systemPrompt: config.systemPrompt,
						metadata,
						runtimeOptions: {
							enableTools: config.enableTools,
							enableSpawn: config.enableSpawn,
							enableTeams: config.enableTeams,
							autoApproveTools: config.autoApproveTools,
						},
					});
					if (!created) {
						return "Failed to create schedule.";
					}
					return [
						`Scheduled "${created.name}".`,
						`id=${created.scheduleId}`,
						`cron=${created.cronPattern}`,
						`nextRunAt=${created.nextRunAt || "pending"}`,
					].join("\n");
				},
				list: async () => {
					const schedules = await input.client.listSchedules({ limit: 200 });
					const matching = schedules.filter((schedule) => {
						const delivery = schedule.metadata?.delivery;
						const deliveryRecord =
							delivery &&
							typeof delivery === "object" &&
							!Array.isArray(delivery)
								? (delivery as Record<string, unknown>)
								: undefined;
						return (
							deliveryRecord?.adapter === input.transport &&
							deliveryRecord.threadId === input.thread.id
						);
					});
					if (matching.length === 0) {
						return "No schedules are targeting this thread.";
					}
					return matching
						.map((schedule) =>
							[
								`${schedule.scheduleId} ${schedule.enabled ? "[enabled]" : "[disabled]"}`,
								`name=${schedule.name}`,
								`cron=${schedule.cronPattern}`,
								`nextRunAt=${schedule.nextRunAt || "pending"}`,
							].join("\n"),
						)
						.join("\n\n");
				},
				trigger: async (scheduleId) => {
					const execution = await input.client.triggerScheduleNow(scheduleId);
					if (!execution) {
						return `Schedule not found: ${scheduleId}`;
					}
					return [
						`Triggered schedule ${scheduleId}.`,
						`executionId=${execution.executionId}`,
						`status=${execution.status}`,
					].join("\n");
				},
				delete: async (scheduleId) => {
					const deleted = await input.client.deleteSchedule(scheduleId);
					return deleted
						? `Deleted schedule ${scheduleId}.`
						: `Schedule not found: ${scheduleId}`;
				},
			},
		})
	) {
		return;
	}

	const currentState = await loadThreadState(
		input.thread,
		input.bindingsPath,
		input.baseStartRequest,
	);
	const effectiveCurrentState = applyForcedToolDisable(
		currentState,
		input.forceDisableTools,
	);
	const startRequest = buildThreadStartRequest(
		input.baseStartRequest,
		effectiveCurrentState,
	);
	const keyedActiveTurn = input.activeTurns?.get(turnKey);
	const activeTurnEntry = keyedActiveTurn
		? ([turnKey, keyedActiveTurn] as const)
		: input.activeTurns && currentState.sessionId?.trim()
			? Array.from(input.activeTurns.entries()).find(
					([, turn]) =>
						turn.sessionId === currentState.sessionId?.trim() &&
						turn.threadId === input.thread.id,
				)
			: undefined;
	if (activeTurnEntry?.[1].sessionId?.trim()) {
		const [activeTurnKey, activeTurn] = activeTurnEntry;
		const { prompt, userImages, userFiles } = await buildUserInputMessage(
			runtimeInput,
			input.userInstructionService,
			{ mode: startRequest.mode },
		);
		try {
			await input.client.sendRuntimeSession(
				activeTurn.sessionId,
				{
					config: startRequest,
					prompt,
					attachments: buildAttachments({ userImages, userFiles }),
					delivery: "steer",
				},
				{ timeoutMs: null },
			);
		} catch (error) {
			if (!isUnusableSessionError(error)) {
				throw error;
			}
			// The tracked turn points at a session that can no longer serve it —
			// the hub does not know it, or its runtime is stuck on a run that never
			// drained.
			// Remove only the entry we attempted to steer, then route recovery
			// through the normal per-thread queue. Concurrent messages that saw
			// the same stale turn will line up behind this one instead of creating
			// independent replacement sessions.
			if (input.activeTurns?.get(activeTurnKey) === activeTurn) {
				input.activeTurns.delete(activeTurnKey);
			}
			const enqueueTurn = input.enqueueTurn;
			if (!enqueueTurn) {
				throw new Error(
					"Active connector turns require a per-thread turn queue",
				);
			}
			await enqueueTurn(() =>
				runConnectorRuntimeTurnWithRecovery({
					input,
					runtimeInput,
					turnKey,
					staleSessionId: activeTurn.sessionId,
				}),
			);
			return;
		}
		// No acknowledgement: the follow-up is handed to the running session and its
		// effect shows up in the answer. Announcing it added a line to every thread
		// and overstated what happens, since the prompt is queued for the session
		// rather than injected into the loop already running.
		return;
	}

	await runConnectorRuntimeTurnWithRecovery({
		input,
		runtimeInput,
		turnKey,
		currentState,
	});
}

/**
 * Runs a queued connector turn, replacing a stale session mapping at most once
 * before replaying the user's input.
 */
async function runConnectorRuntimeTurnWithRecovery<
	TState extends ConnectorThreadState,
>(params: {
	input: ConnectorUserTurnInput<TState>;
	runtimeInput: string;
	turnKey: string;
	currentState?: TState;
	staleSessionId?: string;
}): Promise<void> {
	const { input, runtimeInput, turnKey } = params;
	const currentState =
		params.currentState ??
		(await loadThreadState(
			input.thread,
			input.bindingsPath,
			input.baseStartRequest,
		));
	const effectiveCurrentState = applyForcedToolDisable(
		currentState,
		input.forceDisableTools,
	);
	const startRequest = buildThreadStartRequest(
		input.baseStartRequest,
		effectiveCurrentState,
	);
	const { prompt, userImages, userFiles } = await buildUserInputMessage(
		runtimeInput,
		input.userInstructionService,
		{ mode: startRequest.mode },
	);
	const request: ChatRunTurnRequest = {
		config: startRequest,
		prompt,
		attachments: buildAttachments({ userImages, userFiles }),
	};
	if (params.staleSessionId) {
		await forgetStaleThreadSession({
			thread: input.thread,
			bindingsPath: input.bindingsPath,
			baseStartRequest: input.baseStartRequest,
			errorLabel: input.errorLabel,
			logger: input.logger,
			transport: input.transport,
			sessionId: params.staleSessionId,
		});
	}
	// A thread binding can outlive its runtime session (hub restart, session
	// deletion, retention cleanup). When that happens the turn fails with
	// `session_not_found`; drop the stale mapping and replay the turn once
	// against a brand new session instead of wedging the thread forever.
	const resolveSessionId = () =>
		getOrCreateSessionId({
			thread: input.thread,
			client: input.client,
			startRequest,
			logger: input.logger,
			clientId: input.clientId,
			transport: input.transport,
			bindingsPath: input.bindingsPath,
			errorLabel: input.errorLabel,
			hookCommand: input.hookCommand,
			hookBotUserName: input.botUserName,
			sessionMetadata: input.getSessionMetadata(
				input.thread,
				input.clientId,
				currentState,
			),
			reusedLogMessage: input.reusedLogMessage,
			startedLogMessage: input.startedLogMessage,
		});
	let sessionId = await resolveSessionId();
	let allowStaleSessionRetry = params.staleSessionId === undefined;
	for (;;) {
		try {
			await runConnectorRuntimeTurn({
				input,
				sessionId,
				request,
				currentState,
				turnKey,
			});
			break;
		} catch (error) {
			if (!allowStaleSessionRetry || !isUnusableSessionError(error)) {
				throw error;
			}
			allowStaleSessionRetry = false;
			await forgetStaleThreadSession({
				thread: input.thread,
				bindingsPath: input.bindingsPath,
				baseStartRequest: input.baseStartRequest,
				errorLabel: input.errorLabel,
				logger: input.logger,
				transport: input.transport,
				sessionId,
			});
			sessionId = await resolveSessionId();
		}
	}

	await persistMergedThreadState(
		input.thread,
		input.bindingsPath,
		{
			...currentState,
			sessionId,
		},
		input.errorLabel,
	);
}

/**
 * Runs a single connector turn against an already-resolved session and streams
 * the reply back into the thread.
 */
async function runConnectorRuntimeTurn<
	TState extends ConnectorThreadState,
>(params: {
	input: ConnectorUserTurnInput<TState>;
	sessionId: string;
	request: ChatRunTurnRequest;
	currentState: TState;
	turnKey: string;
}): Promise<void> {
	const { input, sessionId, request, currentState, turnKey } = params;
	const resolveFallbackText = await input.createEmptyRuntimeReplyResolver?.({
		client: input.client,
		sessionId,
	});
	const generatedMedia: GeneratedMedia[] = [];

	const activeTurn: ActiveConnectorTurn = {
		sessionId,
		threadId: input.thread.id,
		participantKey: currentState.participantKey,
	};
	input.activeTurns?.set(turnKey, activeTurn);
	await input.thread.startTyping();
	let toolStatusMessage: SentMessage | undefined;
	const postFinalReply = input.postFinalReply
		? async (text: string) => {
				await input.postFinalReply?.({ thread: input.thread, text });
			}
		: undefined;
	try {
		await postConnectorRuntimeReply(
			input.thread,
			input.transport,
			createConnectorRuntimeTurnStream({
				client: input.client,
				sessionId,
				request,
				clientId: input.clientId,
				logger: input.logger,
				transport: input.transport,
				conversationId: input.thread.id,
				onToolStatus: async (message) => {
					if (toolStatusMessage) {
						toolStatusMessage = await editConnectorText(
							toolStatusMessage,
							input.transport,
							message,
						);
						return;
					}
					toolStatusMessage = await postConnectorText(
						input.thread,
						input.transport,
						message,
					);
				},
				onApprovalRequested: async (approval) => {
					input.pendingApprovals.set(input.thread.id, approval);
					await postConnectorText(
						input.thread,
						input.transport,
						formatConnectorApprovalPrompt(approval),
					);
				},
				onMedia: (media) => {
					generatedMedia.push(media);
				},
				onCompleted: async (result) => {
					await input.onReplyCompleted?.({
						sessionId,
						threadId: input.thread.id,
						text: result.text,
						finishReason: result.finishReason,
						iterations: result.iterations,
					});
				},
				onFailed: async (error) => {
					await input.onReplyFailed?.({
						sessionId,
						threadId: input.thread.id,
						error,
					});
				},
			}),
			postFinalReply,
			resolveFallbackText,
			() => generatedMedia.length > 0,
		);
		await postConnectorGeneratedMedia(input.thread, generatedMedia);
	} finally {
		input.pendingApprovals.delete(input.thread.id);
		if (input.activeTurns?.get(turnKey) === activeTurn) {
			input.activeTurns.delete(turnKey);
		}
		if (toolStatusMessage) {
			await toolStatusMessage.delete().catch(() => undefined);
		}
	}
}

export async function maybeHandleConnectorApprovalReply<
	TState extends ConnectorThreadState,
>(input: {
	thread: Thread<TState>;
	text: string;
	client: HubSessionClient;
	clientId: string;
	pendingApprovals: Map<string, PendingConnectorApproval>;
	deniedReason: string;
	transport?: string;
}): Promise<boolean> {
	const pending = input.pendingApprovals.get(input.thread.id);
	if (!pending) {
		return false;
	}
	const decision = parseConnectorApprovalDecision(
		input.text,
		input.deniedReason,
	);
	if (!decision) {
		await postConnectorText(
			input.thread,
			input.transport ?? "",
			`Approval pending for "${pending.toolName}". Reply "Y" to approve or "N" to deny.`,
		);
		return true;
	}
	input.pendingApprovals.delete(input.thread.id);
	await input.client.respondToolApproval({
		approvalId: pending.approvalId,
		approved: decision.approved,
		reason: decision.reason,
		responderClientId: input.clientId,
	});
	await postConnectorText(
		input.thread,
		input.transport ?? "",
		decision.approved
			? `Approved "${pending.toolName}".`
			: `Denied "${pending.toolName}".`,
	);
	return true;
}
