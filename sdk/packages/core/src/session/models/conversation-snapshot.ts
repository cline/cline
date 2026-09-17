import type { MessageWithMetadata, SessionHistoryEntry } from "@cline/shared";
import {
	agentMessageToMessageWithMetadata,
	messageToAgentMessages,
} from "../../runtime/config/agent-message-codec";

/**
 * Captured provider-neutral conversation, distinct from display history.
 * Normalize strings, text blocks and split tool results through the runtime
 * codec once, so persisted and runtime sources have the same anchor shape.
 */
export class ConversationSnapshot {
	private constructor(private readonly captured: MessageWithMetadata[]) {}

	static capture(
		history: readonly SessionHistoryEntry[],
	): ConversationSnapshot {
		const messages = history.flatMap((entry) =>
			messageToAgentMessages(entry).map((message) => {
				const normalized = agentMessageToMessageWithMetadata(message);
				// Capturing a source must not invent transport identity.
				if (entry.id === undefined) delete normalized.id;
				if (entry.ts === undefined) delete normalized.ts;
				const content = normalized.content;
				if (
					Array.isArray(content) &&
					content.length === 1 &&
					content[0].type === "text" &&
					!content[0].signature
				) {
					normalized.content = content[0].text;
				}
				return normalized;
			}),
		);
		return new ConversationSnapshot(
			JSON.parse(JSON.stringify(messages)) as MessageWithMetadata[],
		);
	}

	/** Isolated copy: compaction cannot mutate its source anchor. */
	get messages(): MessageWithMetadata[] {
		return JSON.parse(JSON.stringify(this.captured)) as MessageWithMetadata[];
	}
}
