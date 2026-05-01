import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type {
	ChatRunTurnRequest,
	ChatStartSessionRequest,
	HubSessionClient,
	UserInstructionConfigService,
} from "@clinebot/core";
import type { SentMessage, Thread } from "chat";
import type { CliLoggerAdapter } from "../logging/adapter";
import { buildUserInputMessage, resolveSystemPrompt } from "../runtime/prompt";
import {
	type ChatCommandHost,
	type ChatCommandState,
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
	getOrCreateSessionId,
} from "./session-runtime";
import {
	type ConnectorThreadState,
	loadThreadState,
	persistMergedThreadState,
	persistThreadBinding,
	resolveThreadBindingKey,
} from "./thread-bindings";

export type ActiveConnectorTurn = {
	sessionId: string;
};

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
): Promise<void> {
	if (transport !== "telegram") {
		await thread.post(stream);
		return;
	}

	let text = "";
	for await (const chunk of stream) {
		text += chunk;
	}
	if (postFinalReply) {
		await postFinalReply(text);
		return;
	}
	await postConnectorText(thread, transport, text);
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

export async function handleConnectorUserTurn<
	TState extends ConnectorThreadState,
>(input: {
	thread: Thread<TState>;
	text: string;
	client: HubSessionClient;
	pendingApprovals: Map<string, PendingConnectorApproval>;
	baseStartRequest: ChatStartSessionRequest;
	explicitSystemPrompt: string | undefined;
	clientId: string;
	logger: CliLoggerAdapter;
	transport: string;
	botUserName?: string;
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
	activeTurns?: Map<string, ActiveConnectorTurn>;
	turnKey?: string;
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
}): Promise<void> {
	const resolvedInput = input.text.trim();
	if (!resolvedInput) {
		return;
	}

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

	const [commandToken = ""] = resolvedInput.trim().split(/\s+/);
	const toolLockCommand = normalizeCommandName(
		commandToken.toLowerCase(),
		input.botUserName,
	).match(/^\/(tools|yolo)$/i);
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
					...(effectiveCurrent.participantKey
						? [`deliveryBindingKey=${effectiveCurrent.participantKey}`]
						: []),
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
							...(current.participantKey
								? {
										bindingKey: current.participantKey,
										participantKey: current.participantKey,
									}
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
					const current = await loadThreadState(
						input.thread,
						input.bindingsPath,
						input.baseStartRequest,
					);
					const schedules = await input.client.listSchedules({ limit: 200 });
					const matching = schedules.filter((schedule) => {
						const delivery = schedule.metadata?.delivery;
						const deliveryRecord =
							delivery &&
							typeof delivery === "object" &&
							!Array.isArray(delivery)
								? (delivery as Record<string, unknown>)
								: undefined;
						const deliveryBindingKey =
							typeof deliveryRecord?.bindingKey === "string"
								? deliveryRecord.bindingKey
								: typeof deliveryRecord?.participantKey === "string"
									? deliveryRecord.participantKey
									: undefined;
						return (
							deliveryRecord?.adapter === input.transport &&
							(current.participantKey
								? deliveryBindingKey === current.participantKey
								: deliveryRecord.threadId === input.thread.id)
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
	const activeTurn = input.activeTurns?.get(turnKey);
	if (activeTurn?.sessionId?.trim()) {
		const { prompt, userImages, userFiles } = await buildUserInputMessage(
			resolvedInput,
			input.userInstructionService,
		);
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
		await postConnectorText(
			input.thread,
			input.transport,
			"Steering current task.",
		);
		return;
	}
	const sessionId = await getOrCreateSessionId({
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
	const { prompt, userImages, userFiles } = await buildUserInputMessage(
		resolvedInput,
		input.userInstructionService,
	);
	const request: ChatRunTurnRequest = {
		config: startRequest,
		prompt,
		attachments: buildAttachments({ userImages, userFiles }),
	};

	input.activeTurns?.set(turnKey, { sessionId });
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
		);
	} finally {
		input.pendingApprovals.delete(input.thread.id);
		input.activeTurns?.delete(turnKey);
		if (toolStatusMessage) {
			await toolStatusMessage.delete().catch(() => undefined);
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
