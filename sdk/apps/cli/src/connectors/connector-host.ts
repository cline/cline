import type {
	RpcChatRunTurnRequest,
	RpcChatStartSessionRequest,
} from "@clinebot/core";
import type { RpcSessionClient } from "@clinebot/rpc";
import type { Thread } from "chat";
import type { CliLoggerAdapter } from "../logging/adapter";
import { resolveSystemPrompt } from "../runtime/prompt";
import {
	type ChatCommandState,
	maybeHandleChatCommand,
} from "../utils/chat-commands";
import { dispatchConnectorHook } from "./hooks";
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
} from "./thread-bindings";

export async function handleConnectorUserTurn<
	TState extends ConnectorThreadState,
>(input: {
	thread: Thread<TState>;
	text: string;
	client: RpcSessionClient;
	pendingApprovals: Map<string, PendingConnectorApproval>;
	baseStartRequest: RpcChatStartSessionRequest;
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
	) => Record<string, unknown>;
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
		baseStartRequest: RpcChatStartSessionRequest,
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
	persistThreadBinding(
		input.bindingsPath,
		input.thread,
		initialState,
		input.errorLabel,
	);

	const textPreview = truncateConnectorText(resolvedInput);
	const receivedDetails = {
		threadId: input.thread.id,
		channelId: input.thread.channelId,
		isDM: input.thread.isDM,
		textLength: resolvedInput.length,
		textPreview,
	};
	if (input.messageReceivedLogMessage) {
		input.logger.core.info?.(input.messageReceivedLogMessage, {
			transport: input.transport,
			...receivedDetails,
		});
	}
	await input.onMessageReceived?.(receivedDetails);

	if (
		await maybeHandleChatCommand(resolvedInput, {
			enabled: true,
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
					input.logger.core.info?.(input.threadResetLogMessage, {
						transport: input.transport,
						threadId: input.thread.id,
					});
				}
				await dispatchConnectorHook(
					input.hookCommand,
					{
						adapter: input.transport,
						botUserName: input.botUserName,
						event: "thread.reset",
						payload: {
							threadId: input.thread.id,
							channelId: input.thread.channelId,
						},
						ts: new Date().toISOString(),
					},
					input.logger,
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
					input.logger.core.warn?.(input.connectorStopLogMessage, {
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
					`isDM=${input.thread.isDM ? "true" : "false"}`,
					`tools=${current.enableTools ? "on" : "off"}`,
					`yolo=${current.autoApproveTools ? "on" : "off"}`,
					`cwd=${current.cwd || input.baseStartRequest.cwd}`,
					`workspaceRoot=${current.workspaceRoot || input.baseStartRequest.workspaceRoot}`,
				].join("\n");
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
		sessionMetadata: input.getSessionMetadata(input.thread, input.clientId),
		reusedLogMessage: input.reusedLogMessage,
		startedLogMessage: input.startedLogMessage,
	});
	const request: RpcChatRunTurnRequest = {
		config: startRequest,
		prompt: resolvedInput,
	};

	await input.thread.startTyping();
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
					await input.thread.post(message);
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
	client: RpcSessionClient;
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
