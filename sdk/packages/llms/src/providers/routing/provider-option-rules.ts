import {
	buildGatewayReasoningOptions,
	resolveModelFamily,
} from "./anthropic-compatible";
import { buildOpenAINativeProviderOptions } from "./generic-compatible";
import {
	buildGlmThinkingProviderOptionsPatch,
	isGlmModel,
	isNativeZaiProvider,
} from "./glm-thinking";
import type {
	MatchedProviderOptionRule,
	ProviderOptionBuildInput,
	ProviderOptionMatchInput,
	ProviderOptionRule,
	ProviderOptionSuppression,
} from "./provider-options-types";
import { buildOpenRouterReasoningOptions } from "./reasoning-codecs";
import {
	buildProviderAndAliasPatch,
	buildThinkingPatch,
	type ProviderOptionsPatch,
} from "./utils";

function isOpenRouterProvider(input: ProviderOptionMatchInput): boolean {
	return input.request.providerId === "openrouter";
}

function isKimiK26Family(input: ProviderOptionMatchInput): boolean {
	return input.modelFamily?.trim().toLowerCase() === "kimi-k2.6";
}

function isMoonshotKimiModel(input: ProviderOptionMatchInput): boolean {
	return input.request.modelId.toLowerCase().includes("moonshotai/kimi-");
}

function isDeepSeekFamily(input: ProviderOptionMatchInput): boolean {
	return !!input.modelFamily?.trim().toLowerCase().includes("deepseek");
}

function resolveFamilyThinkingType(
	input: ProviderOptionMatchInput,
	defaultWhenUnset: "enabled" | "disabled" | undefined,
): "enabled" | "disabled" | undefined {
	const enabled = input.request.reasoning?.enabled;
	if (enabled === true) {
		return "enabled";
	}
	if (enabled === false) {
		return "disabled";
	}
	return defaultWhenUnset;
}

function buildReasoningPatchForProvider(
	input: ProviderOptionBuildInput,
	reasoning: Record<string, unknown> | undefined,
): ProviderOptionsPatch | undefined {
	if (!reasoning) {
		return undefined;
	}
	return buildProviderAndAliasPatch({
		providerId: input.request.providerId,
		providerOptionsKey: input.providerOptionsKey,
		bucketOptions: { reasoning },
	});
}

const directAnthropicProviderRule: ProviderOptionRule = {
	id: "provider.anthropic.direct",
	phase: "provider",
	description:
		"Direct Anthropic owns the anthropic bucket built by the base patch.",
	applies: (input) => input.request.providerId === "anthropic",
	suppresses: { genericFanout: true },
	build: () => undefined,
};

const directGoogleProviderRule: ProviderOptionRule = {
	id: "provider.google.direct",
	phase: "provider",
	description:
		"Direct Google owns the google bucket through Gemini thinkingConfig.",
	applies: (input) => input.request.providerId === "google",
	suppresses: { genericFanout: true },
	build: () => undefined,
};

const openAiAdapterRule: ProviderOptionRule = {
	id: "adapter.openai",
	phase: "adapter",
	description:
		"OpenAI adapter targets the AI SDK openai bucket, not provider-id buckets.",
	applies: (input) => input.target === "openai",
	build: (input) => ({
		openai: {
			strictJsonSchema: false,
			...buildOpenAINativeProviderOptions(input.request),
		},
	}),
};

const openAiCodexRule: ProviderOptionRule = {
	id: "provider.openai-codex",
	phase: "provider",
	description:
		"Codex CLI uses OpenAI Responses options plus provider-id aliases.",
	applies: (input) => input.request.providerId === "openai-codex",
	suppresses: { genericFanout: true },
	build: (input) => {
		const codexOptions = {
			...input.compatibleOptions,
			instructions: input.request.systemPrompt,
			store: false,
			strictJsonSchema: false,
			systemMessageMode: "remove" as const,
		};

		return {
			openai: codexOptions,
			...buildProviderAndAliasPatch({
				providerId: input.request.providerId,
				providerOptionsKey: input.providerOptionsKey,
				bucketOptions: codexOptions,
			}),
		};
	},
};

const genericProviderFanoutRule: ProviderOptionRule = {
	id: "provider.generic-fanout",
	phase: "provider-fanout",
	description:
		"Default OpenAI-compatible providers receive provider-id and camelCase alias buckets.",
	applies: (input) => input.target !== "openai",
	build: (input) =>
		input.suppressions.genericFanout
			? undefined
			: buildProviderAndAliasPatch({
					providerId: input.request.providerId,
					providerOptionsKey: input.providerOptionsKey,
					bucketOptions: input.compatibleOptions,
				}),
};

const clineGatewayReasoningRule: ProviderOptionRule = {
	id: "provider.cline.reasoning",
	phase: "provider-reasoning",
	description: "Cline gateway accepts the shared gateway reasoning shape.",
	applies: (input) => input.request.providerId === "cline",
	build: (input) =>
		buildReasoningPatchForProvider(
			input,
			buildGatewayReasoningOptions(input.request, input.context),
		),
};

const openRouterReasoningRule: ProviderOptionRule = {
	id: "provider.openrouter.reasoning",
	phase: "provider-reasoning",
	description:
		"OpenRouter expects reasoning controls under its first-class reasoning object.",
	applies: isOpenRouterProvider,
	suppresses: { genericThinking: true, genericEffort: true },
	build: (input) =>
		buildReasoningPatchForProvider(
			input,
			buildOpenRouterReasoningOptions(input.request),
		),
};

const geminiThinkingRule: ProviderOptionRule = {
	id: "provider.google-gemini.thinking-config",
	phase: "provider",
	description: "Google/Gemini maps reasoning effort to google.thinkingConfig.",
	applies: (input) =>
		(input.request.providerId === "google" ||
			input.request.providerId === "gemini") &&
		!!input.request.reasoning?.effort,
	build: (input) => ({
		google: {
			thinkingConfig: {
				thinkingLevel: input.request.reasoning?.effort,
				includeThoughts: true,
			},
		},
	}),
};

const clineReasoningDisabledThinkingRule: ProviderOptionRule = {
	id: "provider.cline.disable-thinking",
	phase: "provider",
	description:
		"Cline-routed non-Kimi-K2.6 Moonshot Kimi models use thinking.type=disabled when reasoning is disabled.",
	applies: (input) =>
		input.request.providerId === "cline" &&
		isMoonshotKimiModel(input) &&
		input.request.reasoning?.enabled === false &&
		!isKimiK26Family(input),
	build: (input) =>
		buildThinkingPatch({
			providerId: input.request.providerId,
			providerOptionsKey: input.providerOptionsKey,
			thinkingType: "disabled",
		}),
};

const kimiK26ThinkingRule: ProviderOptionRule = {
	id: "family.kimi-k2.6.thinking",
	phase: "model-family",
	description:
		"Kimi K2.6 uses thinking.type and defaults to enabled when reasoning is unset.",
	applies: (input) => isKimiK26Family(input) && !isOpenRouterProvider(input),
	suppresses: { genericThinking: true },
	build: (input) => {
		const thinkingType = resolveFamilyThinkingType(input, "enabled");
		return thinkingType
			? buildThinkingPatch({
					providerId: input.request.providerId,
					providerOptionsKey: input.providerOptionsKey,
					thinkingType,
				})
			: undefined;
	},
};

const deepSeekThinkingRule: ProviderOptionRule = {
	id: "family.deepseek.thinking",
	phase: "model-family",
	description:
		"DeepSeek models use thinking.type only for explicit reasoning enabled/disabled.",
	applies: (input) =>
		!isOpenRouterProvider(input) &&
		(isDeepSeekFamily(input) || input.request.providerId === "deepseek"),
	suppresses: { genericThinking: true },
	build: (input) => {
		const thinkingType = resolveFamilyThinkingType(input, undefined);
		return thinkingType
			? buildThinkingPatch({
					providerId: input.request.providerId,
					providerOptionsKey: input.providerOptionsKey,
					thinkingType,
				})
			: undefined;
	},
};

const nativeZaiNonGlmSuppressionRule: ProviderOptionRule = {
	id: "provider.zai.non-glm.suppress-generic-thinking",
	phase: "provider",
	description:
		"Native Z.AI non-GLM models should not inherit adaptive OpenAI-compatible thinking.",
	applies: (input) =>
		isNativeZaiProvider(input.request.providerId) &&
		input.request.reasoning?.enabled !== undefined &&
		!isGlmModel(input.request, input.context),
	suppresses: { genericThinking: true },
	build: () => undefined,
};

const nativeZaiGlmThinkingRule: ProviderOptionRule = {
	id: "family.glm.native-zai-thinking",
	phase: "model-overlay",
	description: "Native Z.AI GLM models use thinking.type.",
	applies: (input) =>
		isNativeZaiProvider(input.request.providerId) &&
		isGlmModel(input.request, input.context),
	suppresses: { genericThinking: true },
	build: (input) =>
		buildGlmThinkingProviderOptionsPatch(
			input.request,
			input.context,
			input.providerOptionsKey,
		),
};

const routedGlmReasoningRule: ProviderOptionRule = {
	id: "family.glm.routed-reasoning",
	phase: "model-overlay",
	description:
		"Routed GLM models use the generic reasoning include/exclude shape, not thinking.type.",
	applies: (input) =>
		!isNativeZaiProvider(input.request.providerId) &&
		isGlmModel(input.request, input.context),
	suppresses: { genericThinking: true },
	build: (input) =>
		buildGlmThinkingProviderOptionsPatch(
			input.request,
			input.context,
			input.providerOptionsKey,
			{ includeProviderBuckets: !isOpenRouterProvider(input) },
		),
};

/**
 * The table is the provider/family behavior matrix. Adding a new exception
 * should mean adding a named rule here, not adding a branch in the composer.
 */
export const PROVIDER_OPTION_RULES: ReadonlyArray<ProviderOptionRule> = [
	directAnthropicProviderRule,
	directGoogleProviderRule,
	openAiAdapterRule,
	openAiCodexRule,
	genericProviderFanoutRule,
	clineGatewayReasoningRule,
	openRouterReasoningRule,
	geminiThinkingRule,
	clineReasoningDisabledThinkingRule,
	kimiK26ThinkingRule,
	deepSeekThinkingRule,
	nativeZaiNonGlmSuppressionRule,
	nativeZaiGlmThinkingRule,
	routedGlmReasoningRule,
];

export function matchProviderOptionRules(
	rules: ReadonlyArray<ProviderOptionRule>,
	input: ProviderOptionMatchInput,
): Array<MatchedProviderOptionRule> {
	const matched: Array<MatchedProviderOptionRule> = [];
	for (const rule of rules) {
		if (rule.applies(input)) {
			matched.push({ rule });
		}
	}
	return matched;
}

export function resolveProviderOptionSuppressions(
	matchedRules: ReadonlyArray<MatchedProviderOptionRule>,
): ProviderOptionSuppression {
	return matchedRules.reduce<ProviderOptionSuppression>((result, { rule }) => {
		if (!rule.suppresses) {
			return result;
		}
		return {
			genericThinking:
				result.genericThinking || rule.suppresses.genericThinking || undefined,
			genericEffort:
				result.genericEffort || rule.suppresses.genericEffort || undefined,
			genericFanout:
				result.genericFanout || rule.suppresses.genericFanout || undefined,
		};
	}, {});
}

export function buildProviderOptionRulePatches(
	matchedRules: ReadonlyArray<MatchedProviderOptionRule>,
	input: ProviderOptionBuildInput,
): Array<ProviderOptionsPatch | undefined> {
	return matchedRules.map(({ rule }) => rule.build(input));
}

export function resolveProviderOptionMatchInput(options: {
	request: ProviderOptionMatchInput["request"];
	context: ProviderOptionMatchInput["context"];
	providerOptionsKey: string;
	target: ProviderOptionMatchInput["target"];
	isAnthropicCompatibleModelId: boolean;
	anthropicReasoningPolicyKind?: ProviderOptionMatchInput["anthropicReasoningPolicyKind"];
}): ProviderOptionMatchInput {
	return {
		...options,
		modelFamily: resolveModelFamily(options.context),
	};
}
