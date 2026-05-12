import {
	createContextCompactionPrepareTurn,
	type ProviderConfig,
	type ProviderSettings,
	type ProviderSettingsManager,
	type ReasoningSettings,
	toProviderConfig,
} from "@cline/core";
import type { Message } from "@cline/shared";
import type { Config } from "../../utils/types";

const FALLBACK_MANUAL_COMPACTION_MAX_INPUT_TOKENS = 64_000;

function resolveCompactionReasoningSettings(
	config: Config,
	stored: ProviderSettings | undefined,
): ReasoningSettings | undefined {
	if (config.reasoningEffort) {
		return { enabled: true, effort: config.reasoningEffort };
	}
	return stored?.reasoning;
}

export function resolveCompactionProviderConfig(
	config: Config,
	providerSettingsManager: ProviderSettingsManager,
): ProviderConfig {
	const stored = providerSettingsManager.getProviderSettings(config.providerId);
	const providerConfig = toProviderConfig({
		...(stored ?? {}),
		provider: config.providerId,
		model: config.modelId,
		apiKey: config.apiKey || stored?.apiKey,
		baseUrl: config.baseUrl ?? stored?.baseUrl,
		headers: config.headers ?? stored?.headers,
		reasoning: resolveCompactionReasoningSettings(config, stored),
	} satisfies ProviderSettings);
	const base = {
		...providerConfig,
		...(config.providerConfig ?? {}),
	};
	return {
		...base,
		providerId: base.providerId ?? config.providerId,
		modelId: base.modelId ?? config.modelId,
		knownModels: base.knownModels ?? config.knownModels,
	};
}

export async function compactInteractiveMessages(input: {
	config: Config;
	providerSettingsManager: ProviderSettingsManager;
	sessionId: string;
	messages: Message[];
}): Promise<{ compacted: boolean; messages: Message[] }> {
	const modelInfo = input.config.knownModels?.[input.config.modelId];
	const maxInputTokens =
		input.config.compaction?.maxInputTokens ??
		modelInfo?.maxInputTokens ??
		modelInfo?.contextWindow ??
		FALLBACK_MANUAL_COMPACTION_MAX_INPUT_TOKENS;
	const compact = createContextCompactionPrepareTurn(
		{
			providerConfig: resolveCompactionProviderConfig(
				input.config,
				input.providerSettingsManager,
			),
			providerId: input.config.providerId,
			modelId: input.config.modelId,
			compaction: {
				...input.config.compaction,
				enabled: true,
			},
			logger: input.config.logger,
		},
		{ mode: "manual" },
	);
	if (!compact) {
		return { compacted: false, messages: input.messages };
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
				maxInputTokens: maxInputTokens,
			},
		},
	});
	if (!result) {
		return { compacted: false, messages: input.messages };
	}
	return { compacted: true, messages: result.messages };
}
