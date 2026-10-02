import {
	type BasicLogger,
	type CoreSessionConfig,
	createContextCompactionPrepareTurn,
	createSessionCompactionState,
	type ITelemetryService,
	type SessionCompactionState,
} from "@cline/core";
import {
	type MessageWithMetadata,
	MODEL_COLLECTIONS_BY_PROVIDER_ID,
	type ModelInfo,
} from "@cline/llms";

// Same conservative budget the CLI and VS Code use when the model declares no
// context window, so manual compaction still has a target to shrink toward.
const FALLBACK_MANUAL_COMPACTION_MAX_INPUT_TOKENS = 64_000;

export type CompactDesktopSessionMessagesInput = {
	sessionId: string;
	config: Pick<
		CoreSessionConfig,
		| "providerConfig"
		| "providerId"
		| "modelId"
		| "apiKey"
		| "baseUrl"
		| "headers"
	>;
	messages: MessageWithMetadata[];
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
};

export type CompactDesktopSessionMessagesResult = {
	compacted: boolean;
	compactionState?: SessionCompactionState;
};

/**
 * Run a manual context compaction over a session transcript. Mirrors the
 * CLI's `/compact` (`apps/cli/src/runtime/interactive/compaction.ts`): the
 * full canonical transcript is summarized, never a prior summary, so repeated
 * compactions do not drift. The caller persists the returned sidecar state;
 * the next turn projects it into the working context.
 */
export async function compactDesktopSessionMessages(
	input: CompactDesktopSessionMessagesInput,
): Promise<CompactDesktopSessionMessagesResult> {
	const { providerId, modelId } = input.config;
	const knownModel: ModelInfo | undefined =
		input.config.providerConfig?.knownModels?.[modelId] ??
		MODEL_COLLECTIONS_BY_PROVIDER_ID[providerId]?.models?.[modelId];
	const modelInfo: ModelInfo = knownModel
		? { ...knownModel, id: knownModel.id ?? modelId }
		: {
				id: modelId,
				maxInputTokens: FALLBACK_MANUAL_COMPACTION_MAX_INPUT_TOKENS,
			};
	const compact = createContextCompactionPrepareTurn(
		{
			...input.config,
			compaction: { enabled: true },
			logger: input.logger,
			telemetry: input.telemetry,
			sessionId: input.sessionId,
		},
		{ mode: "manual" },
	);
	if (!compact) {
		return { compacted: false };
	}
	const conversationMessages = input.messages.filter(
		(message) => message.metadata?.displayOnly !== true,
	);
	const result = await compact({
		agentId: "desktop",
		conversationId: input.sessionId,
		parentAgentId: null,
		iteration: 0,
		messages: conversationMessages,
		apiMessages: conversationMessages,
		abortSignal: new AbortController().signal,
		systemPrompt: "",
		tools: [],
		model: { id: modelId, provider: providerId, info: modelInfo },
	});
	if (!result?.messages) {
		return { compacted: false };
	}
	return {
		compacted: true,
		compactionState: createSessionCompactionState({
			sourceMessages: input.messages,
			compactedMessages: result.messages,
			conversationId: input.sessionId,
			systemPrompt: result.systemPrompt,
		}),
	};
}
