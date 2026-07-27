import { SessionSource } from "@cline/core";
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
	const forkMetadata: Record<string, unknown> = {};
	const sourceMetadata = input.sourceSession?.metadata ?? undefined;

	if (sourceMetadata) {
		for (const [key, value] of Object.entries(sourceMetadata)) {
			if (key !== "fork") {
				forkMetadata[key] = value;
			}
		}
	}

	const checkpointMetadata = sourceMetadata?.checkpoint;
	forkMetadata.fork = {
		forkedFromSessionId: input.forkedFromSessionId,
		forkedAt: input.forkedAt,
		source: input.sourceSession?.source ?? SessionSource.CLI,
		...(checkpointMetadata !== undefined
			? { checkpoints: checkpointMetadata }
			: {}),
	};
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
