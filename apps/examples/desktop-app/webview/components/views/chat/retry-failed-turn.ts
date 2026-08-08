export type RetryTurnPayload = {
	prompt: string;
	attachments: File[];
};

// Selection policy for the Retry action on a failed turn: prefer the exact
// payload of the most recent send — the original prompt text plus the original
// attachments — because the transcript only stores a display label such as
// "[attached 2 files]", not the files themselves. The transcript-derived text
// is only a fallback for failures that predate any send from this pane (it
// cannot recover attachments).
export function resolveRetryTurnPayload(
	lastSentTurn: RetryTurnPayload | null,
	transcriptPrompt: string,
): RetryTurnPayload | null {
	if (lastSentTurn) {
		return {
			prompt: lastSentTurn.prompt,
			attachments: [...lastSentTurn.attachments],
		};
	}
	const prompt = transcriptPrompt.trim();
	if (!prompt) {
		return null;
	}
	return { prompt, attachments: [] };
}
