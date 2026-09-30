/**
 * Per-session conversation transcript store.
 *
 * @see PLAN.md §3.1 — moved from `packages/agents/src/runtime/conversation-store.ts`.
 * @see PLAN.md §3.2.3 — public surface of `ConversationStore`.
 *
 * Pure port of the old agents implementation. Owns the message list,
 * conversation id, and "session started" gate that today's `Agent`
 * class uses to decide when to fire `session_start` hooks.
 */

import type { MessageWithMetadata } from "@cline/shared";

/** Generate a fresh conversation id. Exported for reuse by `SessionRuntime`. */
export function createConversationId(): string {
	return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export class ConversationStore {
	private messages: MessageWithMetadata[] = [];
	private conversationId = createConversationId();
	private sessionStarted = false;

	constructor(initialMessages?: readonly MessageWithMetadata[]) {
		if ((initialMessages?.length ?? 0) > 0) {
			this.restore(initialMessages ?? []);
		}
	}

	getConversationId(): string {
		return this.conversationId;
	}

	getMessages(): MessageWithMetadata[] {
		return [...this.messages];
	}

	appendMessage(message: MessageWithMetadata): void {
		this.messages.push(message);
	}

	appendMessages(messages: readonly MessageWithMetadata[]): void {
		if (messages.length === 0) {
			return;
		}
		this.messages.push(...messages);
	}

	replaceMessages(messages: readonly MessageWithMetadata[]): void {
		// Agent snapshots exclude display-only entries. Reinsert each after its
		// closest surviving predecessor; compacted-away history lands at the start.
		const indices = new Map(
			messages.map((message, index) => [message.id, index]),
		);
		const insertions = new Map<number, MessageWithMetadata[]>();
		let anchor = -1;
		for (const message of this.messages) {
			const index = message.id ? indices.get(message.id) : undefined;
			if (index !== undefined) {
				anchor = index;
			} else if (message.metadata?.displayOnly === true) {
				const entries = insertions.get(anchor) ?? [];
				entries.push(message);
				insertions.set(anchor, entries);
			}
		}
		this.messages = [...(insertions.get(-1) ?? [])];
		for (const [index, message] of messages.entries()) {
			this.messages.push(message, ...(insertions.get(index) ?? []));
		}
	}

	resetForRun(): void {
		this.messages = [];
		this.conversationId = createConversationId();
		this.sessionStarted = false;
	}

	clearHistory(): void {
		this.messages = [];
		this.conversationId = createConversationId();
		this.sessionStarted = false;
	}

	restore(messages: readonly MessageWithMetadata[]): void {
		this.messages = [...messages];
		this.sessionStarted = false;
	}

	isSessionStarted(): boolean {
		return this.sessionStarted;
	}

	markSessionStarted(): void {
		this.sessionStarted = true;
	}
}
