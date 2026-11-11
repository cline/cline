import type { ChatSessionStatus } from "@/lib/chat-schema";

/** The chat pane currently on screen, exposed so the voice manager can drive it. */
export type VoiceManagerActiveChat = {
	threadId: string;
	sessionId: string | null;
	status: ChatSessionStatus;
	isHydrating: boolean;
	/** Settles when the agent's turn ends; false if the prompt never reached it. */
	send: (prompt: string) => Promise<boolean>;
};

let activeChat: VoiceManagerActiveChat | null = null;
const listeners = new Set<() => void>();

export function setVoiceManagerActiveChat(chat: VoiceManagerActiveChat): void {
	activeChat = chat;
	for (const listener of [...listeners]) listener();
}

export function clearVoiceManagerActiveChat(threadId: string): void {
	if (activeChat?.threadId === threadId) activeChat = null;
}

export function getVoiceManagerActiveChat(): VoiceManagerActiveChat | null {
	return activeChat;
}

export function waitForVoiceManagerActiveChat(
	predicate: (chat: VoiceManagerActiveChat) => boolean,
	timeoutMs = 15_000,
): Promise<VoiceManagerActiveChat> {
	return new Promise((resolve, reject) => {
		const check = () => {
			if (!activeChat || !predicate(activeChat)) return;
			cleanup();
			resolve(activeChat);
		};
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("Timed out waiting for the chat to open"));
		}, timeoutMs);
		const cleanup = () => {
			clearTimeout(timer);
			listeners.delete(check);
		};
		listeners.add(check);
		check();
	});
}
