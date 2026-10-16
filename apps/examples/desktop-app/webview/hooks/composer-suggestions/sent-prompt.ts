import { formatDisplayUserInput } from "@cline/shared/browser";
import { buildUserRunCountMap } from "@/components/views/chat/messages/group-messages";
import type { ChatMessage } from "@/lib/chat-schema";

/** A prompt taken back from the queue goes in front of anything typed since, never over it. */
export function takenBackDraft(prompt: string, draft: string): string {
	return draft.trim() && !samePrompt(draft, prompt)
		? `${prompt}\n\n${draft}`
		: prompt;
}

export function samePrompt(text: string, prompt: string): boolean {
	return formatDisplayUserInput(text.trim()).trim() === prompt.trim();
}

/** The last user message showing `prompt`, with the run count a fork from before it needs. */
export function findSentMessage(
	messages: ChatMessage[],
	prompt: string,
): { messageId: string; runCount: number } | undefined {
	const runCounts = buildUserRunCountMap(messages);
	const message = messages.findLast(
		(candidate) =>
			candidate.role === "user" && samePrompt(candidate.content, prompt),
	);
	const runCount = message ? runCounts.get(message) : undefined;
	return message && runCount !== undefined
		? { messageId: message.id, runCount }
		: undefined;
}
