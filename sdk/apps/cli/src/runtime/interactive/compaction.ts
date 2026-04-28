import { createContextCompactionPrepareTurn } from "@clinebot/core";
import type { Message } from "@clinebot/shared";
import type { Config } from "../../utils/types";

const FALLBACK_MANUAL_COMPACTION_CONTEXT_WINDOW_TOKENS = 64_000;
const MANUAL_COMPACTION_THRESHOLD_RATIO = 0.5;

export async function compactInteractiveMessages(input: {
	config: Config;
	sessionId: string;
	messages: Message[];
}): Promise<Message[]> {
	const modelInfo = input.config.knownModels?.[input.config.modelId];
	const contextWindowTokens =
		input.config.compaction?.contextWindowTokens ??
		modelInfo?.contextWindow ??
		FALLBACK_MANUAL_COMPACTION_CONTEXT_WINDOW_TOKENS;
	const compact = createContextCompactionPrepareTurn({
		providerConfig: undefined,
		providerId: input.config.providerId,
		modelId: input.config.modelId,
		compaction: {
			enabled: true,
			strategy: input.config.compaction?.strategy ?? "basic",
			...(typeof input.config.compaction?.contextWindowTokens === "number"
				? { contextWindowTokens: input.config.compaction.contextWindowTokens }
				: {}),
			thresholdRatio: Math.max(
				input.config.compaction?.thresholdRatio ??
					MANUAL_COMPACTION_THRESHOLD_RATIO,
				0.25,
			),
		},
	});
	if (!compact) {
		return input.messages;
	}
	const result = await compact({
		agentId: "cli",
		conversationId: input.sessionId,
		parentAgentId: null,
		iteration: 0,
		messages: input.messages,
		apiMessages: input.messages,
		abortSignal: new AbortController().signal,
		systemPrompt: "",
		tools: [],
		model: {
			id: input.config.modelId,
			provider: input.config.providerId,
			info: {
				...(modelInfo ?? {}),
				id: modelInfo?.id ?? input.config.modelId,
				contextWindow: contextWindowTokens,
			},
		},
	});
	return result?.messages ?? input.messages;
}
