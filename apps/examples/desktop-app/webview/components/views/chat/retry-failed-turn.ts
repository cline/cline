import { formatChatMessageContent } from "./message-content";

export type RetryTurnPayload = {
	prompt: string;
	attachments: File[];
};

export type SentTurnRecord = RetryTurnPayload & {
	// The transcript content this send produced for its user bubble (built with
	// buildUserPromptDisplayLabel), used to match a failed turn back to its
	// original payload.
	displayLabel: string;
};

// Concurrent sends are bounded by how many prompts can realistically be
// queued behind a running turn before one of them fails.
export const MAX_RETAINED_SENT_TURNS = 10;

export function recordSentTurn(
	records: readonly SentTurnRecord[],
	record: SentTurnRecord,
): SentTurnRecord[] {
	return [...records.slice(-(MAX_RETAINED_SENT_TURNS - 1)), record];
}

// Selection policy for the Retry action on a failed turn. The transcript's
// last user message identifies which turn failed, but its content is only a
// display label (attachments render as "[attached 2 files]", not the files
// themselves), so the original payload — exact prompt text plus attachments —
// is recovered from the retained send records. Matching by display label
// (newest first) rather than taking the newest send keeps the retry on the
// failed turn even when another prompt was submitted (and retained) while the
// failed one was still running. Without a match — e.g. a failure that predates
// any send from this pane — the display text is retried as-is, which cannot
// recover attachments.
export function resolveRetryTurnPayload(
	sentTurns: readonly SentTurnRecord[],
	transcriptPrompt: string,
): RetryTurnPayload | null {
	for (let i = sentTurns.length - 1; i >= 0; i--) {
		const candidate = sentTurns[i];
		const candidateTranscriptPrompt = formatChatMessageContent(
			"user",
			candidate.displayLabel,
		).trim();
		if (candidateTranscriptPrompt === transcriptPrompt) {
			return {
				prompt: candidate.prompt,
				attachments: [...candidate.attachments],
			};
		}
	}
	const prompt = transcriptPrompt.trim();
	if (!prompt) {
		return null;
	}
	return { prompt, attachments: [] };
}
