import {
	type AgentTool,
	createTool,
	type SessionListPeersInput,
	SessionListPeersInputSchema,
	type SessionMessage,
	type SessionMessageToolResult,
	SessionMessageToolResultSchema,
	type SessionPeerToolResult,
	SessionPeerToolResultSchema,
	type SessionReadInboxInput,
	SessionReadInboxInputSchema,
	type SessionSendMessageInput,
	SessionSendMessageInputSchema,
	type SessionSendMessageToolResult,
	SessionSendMessageToolResultSchema,
	validateWithZod,
	zodToJsonSchema,
} from "@cline/shared";
import {
	SessionMessageRejectedError,
	type SessionMessenger,
} from "../../../session/messaging/session-messenger";

export const SESSION_MAIL_TOOL_NAMES = [
	"session_list_peers",
	"session_send_message",
	"session_read_inbox",
] as const;

export interface CreateSessionMailToolsOptions {
	messenger: SessionMessenger;
	/** The session these tools act on behalf of. */
	sessionId: string;
	/** Restricts peer listing to the caller's workspace when set. */
	workspaceRoot?: string;
}

function toMessageResult(message: SessionMessage): SessionMessageToolResult {
	return {
		id: message.id,
		fromSessionId: message.fromSessionId,
		fromLabel: message.fromLabel,
		toSessionId: message.toSessionId,
		subject: message.subject,
		body: message.body,
		delivery: message.delivery,
		status: message.status,
		hopCount: message.hopCount,
		sentAt: message.sentAt.toISOString(),
		deliveredAt: message.deliveredAt?.toISOString(),
		readAt: message.readAt?.toISOString(),
	};
}

export function createSessionMailTools(
	options: CreateSessionMailToolsOptions,
): AgentTool[] {
	const tools: AgentTool[] = [];

	tools.push(
		createTool<SessionListPeersInput, SessionPeerToolResult[]>({
			name: "session_list_peers",
			description:
				"List other Cline sessions you can message. Returns sessionIds to use " +
				"with session_send_message, plus whether each one is live right now.",
			inputSchema: zodToJsonSchema(SessionListPeersInputSchema),
			execute: async (input) => {
				const validated = validateWithZod(SessionListPeersInputSchema, input);
				const peers = await options.messenger.listPeers({
					reachableOnly: validated.reachableOnly ?? undefined,
					workspaceRoot: validated.workspaceRoot ?? undefined,
					limit: validated.limit ?? undefined,
					excludeSessionId: options.sessionId,
				});
				return validateWithZod(SessionPeerToolResultSchema.array(), peers);
			},
		}) as AgentTool,
	);

	tools.push(
		createTool<SessionSendMessageInput, SessionSendMessageToolResult>({
			name: "session_send_message",
			description:
				"Send a message to another Cline session. The message is stored durably " +
				"and delivered to the target as a user turn, waking it if it is idle. " +
				"Use delivery 'steer' only when the target should stop what it is doing.",
			inputSchema: zodToJsonSchema(SessionSendMessageInputSchema),
			execute: async (input) => {
				const validated = validateWithZod(SessionSendMessageInputSchema, input);
				try {
					const result = await options.messenger.send({
						fromSessionId: options.sessionId,
						toSessionId: validated.toSessionId,
						subject: validated.subject,
						body: validated.body,
						delivery: validated.delivery ?? undefined,
					});
					return validateWithZod(SessionSendMessageToolResultSchema, {
						id: result.message.id,
						toSessionId: result.message.toSessionId,
						status: result.message.status,
						deliveredNow: result.deliveredNow,
						hopCount: result.message.hopCount,
					});
				} catch (error) {
					if (error instanceof SessionMessageRejectedError) {
						// Structured refusal rather than a throw: a rejected send is a
						// normal outcome the agent should reason about, not a mistake
						// counted against its error budget.
						throw new Error(`${error.reason}: ${error.message}`);
					}
					throw error;
				}
			},
		}) as AgentTool,
	);

	tools.push(
		createTool<SessionReadInboxInput, SessionMessageToolResult[]>({
			name: "session_read_inbox",
			description:
				"Read messages other sessions have sent to this session. " +
				"Messages are marked read once returned.",
			inputSchema: zodToJsonSchema(SessionReadInboxInputSchema),
			execute: async (input) => {
				const validated = validateWithZod(SessionReadInboxInputSchema, input);
				const messages = options.messenger.readInbox({
					sessionId: options.sessionId,
					unreadOnly: validated.unreadOnly ?? undefined,
					limit: validated.limit ?? undefined,
					markRead: true,
				});
				return validateWithZod(
					SessionMessageToolResultSchema.array(),
					messages.map(toMessageResult),
				);
			},
		}) as AgentTool,
	);

	return tools;
}
