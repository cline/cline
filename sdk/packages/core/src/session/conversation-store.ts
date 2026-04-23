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

import type { MessageWithMetadata } from "@clinebot/shared";

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
		this.messages = [...messages];
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
