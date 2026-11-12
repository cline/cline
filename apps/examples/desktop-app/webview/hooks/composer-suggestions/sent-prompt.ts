import { formatDisplayUserInput } from "@cline/shared/browser";
import { buildUserRunCountMap } from "@/components/views/chat/messages/group-messages";
import { withoutAttachedFilesLabel } from "@/lib/attached-files-label";
import type { ChatMessage } from "@/lib/chat-schema";

/** A prompt taken back from the queue goes in front of anything typed since, never over it. */
export function takenBackDraft(prompt: string, draft: string): string {
	return draft.trim() && !samePrompt(draft, prompt)
		? `${prompt}\n\n${draft}`
		: prompt;
}

export function samePrompt(text: string, prompt: string): boolean {
	return (
		formatDisplayUserInput(withoutAttachedFilesLabel(text.trim())).trim() ===
		prompt.trim()
	);
}

/** Taken when a suggestion is sent: its message will follow `runCount`, and `attachments` went with it. */
export type SendSnapshot = { runCount: number; attachments: readonly File[] };

export function snapshotAtSend(
	messages: ChatMessage[],
	attachments: readonly File[],
): SendSnapshot {
	return {
		runCount: Math.max(0, ...buildUserRunCountMap(messages).values()),
		attachments,
	};
}

/**
 * The message a prompt sent at `afterRunCount` became, with the run count a
 * fork from before it needs. Only later turns count, so a copy sent earlier
 * is never taken for it.
 */
export function findSentMessage(
	messages: ChatMessage[],
	prompt: string,
	afterRunCount: number,
): { messageId: string; runCount: number } | undefined {
	for (const [message, runCount] of buildUserRunCountMap(messages)) {
		if (runCount > afterRunCount && samePrompt(message.content, prompt)) {
			return { messageId: message.id, runCount };
		}
	}
	return undefined;
}
