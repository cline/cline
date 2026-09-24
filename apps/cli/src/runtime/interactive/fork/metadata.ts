import { createForkSessionMetadata, SessionSource } from "@cline/core";
import type { Message } from "@cline/shared";
import { deriveForkSessionTitle } from "./title";

type SourceSession = {
	source?: SessionSource;
	prompt?: string | null;
	metadata?: Record<string, unknown> | null;
};

export function buildForkSessionMetadata(input: {
	forkedFromSessionId: string;
	forkedAt: string;
	sourceSession?: SourceSession;
	messages: Message[];
}): Record<string, unknown> {
	const sourceMetadata = input.sourceSession?.metadata ?? undefined;
	const forkMetadata = createForkSessionMetadata({
		metadata: sourceMetadata,
		forkedFromSessionId: input.forkedFromSessionId,
		forkedAt: input.forkedAt,
		source: input.sourceSession?.source ?? SessionSource.CLI,
	});
	forkMetadata.title = deriveForkSessionTitle({
		sourceTitle:
			typeof sourceMetadata?.title === "string"
				? sourceMetadata.title
				: undefined,
		sourcePrompt: input.sourceSession?.prompt,
		messages: input.messages,
	});

	return forkMetadata;
}
