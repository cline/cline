import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type {
	ChatRunTurnRequest,
	ChatStartSessionRequest,
	UserInstructionConfigWatcher,
} from "@clinebot/core";
import type { HubSessionClient } from "@clinebot/hub";
import type { SentMessage, Thread } from "chat";
import type { CliLoggerAdapter } from "../logging/adapter";
import { buildUserInputMessage, resolveSystemPrompt } from "../runtime/prompt";
import {
	type ChatCommandHost,
	type ChatCommandState,
	maybeHandleChatCommand,
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
	userInstructionWatcher?: UserInstructionConfigWatcher;
	activeTurns?: Map<string, ActiveConnectorTurn>;
	turnKey?: string;
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
		await input.thread.post(denialMessage);
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
		await input.thread.post(firstContactMessage.trim());
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

	if (
		await maybeHandleChatCommand(resolvedInput, {
			enabled: true,
			host: input.chatCommandHost,
			getState: async () => {
				const current = await loadThreadState(
					input.thread,
					input.bindingsPath,
					input.baseStartRequest,
				);
				return {
					enableTools:
						current.enableTools ?? input.baseStartRequest.enableTools,
					autoApproveTools:
						current.autoApproveTools ??
						input.baseStartRequest.autoApproveTools === true,
					cwd:
						current.cwd ||
						input.baseStartRequest.cwd ||
						input.baseStartRequest.workspaceRoot,
					workspaceRoot:
						current.workspaceRoot || input.baseStartRequest.workspaceRoot,
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
					enableTools: next.enableTools,
					autoApproveTools: next.autoApproveTools,
					cwd: next.cwd,
					workspaceRoot: next.workspaceRoot,
					systemPrompt,
				};
				const runtimeConfigChanged =
					(currentState.enableTools ?? input.baseStartRequest.enableTools) !==
						next.enableTools ||
					(currentState.autoApproveTools ??
						input.baseStartRequest.autoApproveTools === true) !==
						next.autoApproveTools ||
					(currentState.cwd || input.baseStartRequest.cwd) !== next.cwd ||
					(currentState.workspaceRoot ||
						input.baseStartRequest.workspaceRoot) !== next.workspaceRoot ||
					(currentState.systemPrompt || input.baseStartRequest.systemPrompt) !==
						systemPrompt;
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
				await input.thread.post(message);
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
					await input.thread.post("No active task to abort.");
					return;
				}
				await input.client.abortRuntimeSession(activeTurn.sessionId);
				await input.thread.post("Aborting current task.");
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
				if (input.onDescribe) {
					return input.onDescribe(
						current,
						input.baseStartRequest,
						input.thread,
					);
				}
				return [
					`threadId=${input.thread.id}`,
					`channelId=${input.thread.channelId}`,
					`deliveryAdapter=${input.transport}`,
					`deliveryThread=${input.thread.id}`,
					...(current.participantKey
						? [`deliveryBindingKey=${current.participantKey}`]
						: []),
					`deliveryChannel=${input.thread.channelId}`,
					...(input.botUserName
						? [`deliveryUserName=${input.botUserName}`]
						: []),
					...(current.participantLabel
						? [`participant=${current.participantLabel}`]
						: []),
					...(current.participantKey
						? [`participantKey=${current.participantKey}`]
						: []),
					`isDM=${input.thread.isDM ? "true" : "false"}`,
					`tools=${current.enableTools ? "on" : "off"}`,
					`yolo=${current.autoApproveTools ? "on" : "off"}`,
					`cwd=${current.cwd || input.baseStartRequest.cwd}`,
					`workspaceRoot=${current.workspaceRoot || input.baseStartRequest.workspaceRoot}`,
				].join("\n");
			},
			schedule: {
				create: async ({ name, cronPattern, prompt }) => {
					const current = await loadThreadState(
						input.thread,
						input.bindingsPath,
						input.baseStartRequest,
					);
					const config = buildThreadStartRequest(
						input.baseStartRequest,
						current,
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
						maxIterations: config.maxIterations,
						metadata,
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
	const startRequest = buildThreadStartRequest(
		input.baseStartRequest,
		currentState,
	);
	const activeTurn = input.activeTurns?.get(turnKey);
	if (activeTurn?.sessionId?.trim()) {
		const { prompt, userImages, userFiles } = await buildUserInputMessage(
			resolvedInput,
			input.userInstructionWatcher,
		);
		await input.client.sendRuntimeSession(activeTurn.sessionId, {
			config: startRequest,
			prompt,
			attachments: buildAttachments({ userImages, userFiles }),
			delivery: "steer",
		});
		await input.thread.post("Steering current task.");
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
		input.userInstructionWatcher,
	);
	const request: ChatRunTurnRequest = {
		config: startRequest,
		prompt,
		attachments: buildAttachments({ userImages, userFiles }),
	};

	input.activeTurns?.set(turnKey, { sessionId });
	await input.thread.startTyping();
	let toolStatusMessage: SentMessage | undefined;
	try {
		await input.thread.post(
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
						toolStatusMessage = await toolStatusMessage.edit(message);
						return;
					}
					toolStatusMessage = await input.thread.post(message);
				},
				onApprovalRequested: async (approval) => {
					input.pendingApprovals.set(input.thread.id, approval);
					await input.thread.post(formatConnectorApprovalPrompt(approval));
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
		await input.thread.post(
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
	await input.thread.post(
		decision.approved
			? `Approved "${pending.toolName}".`
			: `Denied "${pending.toolName}".`,
	);
	return true;
}
