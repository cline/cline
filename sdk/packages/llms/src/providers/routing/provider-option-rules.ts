import { isClineProvider } from "@cline/shared";
import {
	isDeepSeekFamily,
	isGemini3Model,
	isGeminiFlashModel,
	isGeminiProModel,
	isGlmModel,
	isKimiK26Family as isKimiK26FamilyFact,
	isMiniMaxM3Model,
	isMoonshotKimiModelIdFallback,
	modelReasoningDefaultsOn,
	providerReasoningRouteMatches,
	supportsGeminiThinking,
} from "../model-facts";
import { buildGatewayReasoningOptions } from "./anthropic-compatible";
import { buildOpenAINativeProviderOptions } from "./generic-compatible";
import {
	buildNativeGlmThinkingProviderOptionsPatch,
	buildRoutedGlmReasoningProviderOptionsPatch,
} from "./glm-thinking";
import {
	buildMiniMaxGatewayReasoningProviderOptionsPatch,
	buildMiniMaxThinkingProviderOptionsPatch,
} from "./minimax-thinking";
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

function isKimiK26Family(input: ProviderOptionMatchInput): boolean {
	return isKimiK26FamilyFact(input.context);
}

function isMoonshotKimiModel(input: ProviderOptionMatchInput): boolean {
	return isMoonshotKimiModelIdFallback(input.request);
}

function isDeepSeekModelOrProviderDefault(
	input: ProviderOptionMatchInput,
): boolean {
	return (
		isDeepSeekFamily(input.context) || input.request.providerId === "deepseek"
	);
}

function isMiniMaxM3(input: ProviderOptionMatchInput): boolean {
	return isMiniMaxM3Model(input.request, input.context);
}

function isOllamaReasoningDefaultOnDisable(
	input: ProviderOptionMatchInput,
): boolean {
	return (
		input.request.providerId === "ollama" &&
		input.request.reasoning?.enabled === false &&
		modelReasoningDefaultsOn({
			request: input.request,
			context: input.context,
		})
	);
}

function usesGlmThinkingProviderRouting(
	input: ProviderOptionMatchInput,
): boolean {
	return providerReasoningRouteMatches(
		"glm-thinking",
		input.request,
		input.context,
	);
}

function hasGlmThinkingProviderRouting(
	input: ProviderOptionMatchInput,
): boolean {
	return (
		input.context.provider.metadata?.routing?.reasoning?.format ===
		"glm-thinking"
	);
}

function usesMiniMaxThinkingProviderRouting(
	input: ProviderOptionMatchInput,
): boolean {
	return providerReasoningRouteMatches(
		"minimax-thinking",
		input.request,
		input.context,
	);
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

const GEMINI_25_THINKING_BUDGET_BY_EFFORT = {
	low: 1_024,
	medium: 8_192,
	high: 24_576,
} as const;

function buildGeminiThinkingConfig(input: ProviderOptionBuildInput):
	| {
			thinkingLevel?: "minimal" | "low" | "medium" | "high";
			thinkingBudget?: number;
			includeThoughts: boolean;
	  }
	| undefined {
	const reasoning = input.request.reasoning;
	if (!reasoning) {
		return undefined;
	}

	if (isGemini3Model(input)) {
		if (reasoning.enabled === false) {
			return {
				thinkingLevel: isGeminiFlashModel(input) ? "minimal" : "low",
				includeThoughts: false,
			};
		}
		if (!reasoning.effort) {
			return undefined;
		}
		return {
			thinkingLevel: reasoning.effort,
			includeThoughts: true,
		};
	}

	if (reasoning.enabled === false) {
		return {
			thinkingBudget: isGeminiProModel(input) ? 128 : 0,
			includeThoughts: false,
		};
	}

	if (typeof reasoning.budgetTokens === "number") {
		return {
			thinkingBudget: reasoning.budgetTokens,
			includeThoughts: true,
		};
	}

	if (!reasoning.effort) {
		return undefined;
	}

	return {
		thinkingBudget: GEMINI_25_THINKING_BUDGET_BY_EFFORT[reasoning.effort],
		includeThoughts: true,
	};
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
	applies: (input) => isClineProvider(input.request.providerId),
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
	applies: (input) => input.request.providerId === "openrouter",
	suppresses: { genericThinking: true, genericEffort: true },
	build: (input) =>
		buildReasoningPatchForProvider(
			input,
			buildOpenRouterReasoningOptions(input.request),
		),
};

const clineMiniMaxM3GatewayReasoningRule: ProviderOptionRule = {
	id: "provider.cline.minimax-m3.gateway-reasoning",
	phase: "provider-reasoning",
	description:
		"Cline-routed MiniMax M3 keeps the gateway reasoning shape instead of leaking generic thinking.",
	applies: (input) =>
		input.request.providerId === "cline" && isMiniMaxM3(input),
	suppresses: { genericThinking: true, genericEffort: true },
	build: () => undefined,
};

const vercelMiniMaxM3GatewayReasoningRule: ProviderOptionRule = {
	id: "provider.vercel-ai-gateway.minimax-m3.gateway-reasoning",
	phase: "provider-reasoning",
	description:
		"Vercel-routed MiniMax M3 uses the gateway reasoning include/exclude shape.",
	applies: (input) =>
		input.request.providerId === "vercel-ai-gateway" && isMiniMaxM3(input),
	suppresses: { genericThinking: true, genericEffort: true },
	build: (input) =>
		buildMiniMaxGatewayReasoningProviderOptionsPatch(
			input.request,
			input.providerOptionsKey,
		),
};

const geminiThinkingRule: ProviderOptionRule = {
	id: "provider.google-gemini.thinking-config",
	phase: "provider",
	description: "Google/Gemini/Vertex maps reasoning to thinkingConfig.",
	suppresses: { genericThinking: true, genericEffort: true },
	applies: (input) =>
		(input.request.providerId === "google" ||
			input.request.providerId === "gemini" ||
			input.request.providerId === "vertex") &&
		supportsGeminiThinking(input) &&
		(!!input.request.reasoning?.effort ||
			typeof input.request.reasoning?.budgetTokens === "number" ||
			input.request.reasoning?.enabled === false),
	build: (input) => {
		const providerOptionsName =
			input.request.providerId === "vertex" ? "vertex" : "google";
		const thinkingConfig = buildGeminiThinkingConfig(input);
		if (!thinkingConfig) {
			return undefined;
		}
		return {
			[providerOptionsName]: {
				thinkingConfig,
			},
		};
	},
};

const clineReasoningDisabledThinkingRule: ProviderOptionRule = {
	id: "provider.cline.disable-thinking",
	phase: "provider",
	description:
		"Cline-routed non-Kimi-K2.6 Moonshot Kimi models use thinking.type=disabled when reasoning is disabled.",
	applies: (input) =>
		isClineProvider(input.request.providerId) &&
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
	applies: (input) =>
		isKimiK26Family(input) && input.request.providerId !== "openrouter",
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
		input.request.providerId !== "openrouter" &&
		isDeepSeekModelOrProviderDefault(input) &&
		!isOllamaReasoningDefaultOnDisable(input),
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

const ollamaReasoningDefaultOnDisableRule: ProviderOptionRule = {
	id: "provider.ollama.reasoning-default-on.disable-none",
	phase: "provider-reasoning",
	description:
		"Ollama models whose reasoning defaults on need reasoningEffort=none when request reasoning is disabled.",
	applies: isOllamaReasoningDefaultOnDisable,
	build: (input) => {
		const bucketOptions = {
			reasoningEffort: "none",
			reasoning: { effort: "none" },
		};
		return {
			...buildProviderAndAliasPatch({
				providerId: input.request.providerId,
				providerOptionsKey: input.providerOptionsKey,
				bucketOptions,
			}),
			openaiCompatible: bucketOptions,
		};
	},
};

const nonGlmProviderRoutingSuppressionRule: ProviderOptionRule = {
	id: "provider.routing.glm-thinking.non-glm.suppress-generic-thinking",
	phase: "provider",
	description:
		"Providers with GLM thinking routing should not apply generic adaptive thinking to non-GLM models.",
	applies: (input) =>
		hasGlmThinkingProviderRouting(input) &&
		input.request.reasoning?.enabled !== undefined &&
		!usesGlmThinkingProviderRouting(input),
	suppresses: { genericThinking: true },
	build: () => undefined,
};

const nativeZaiGlmThinkingRule: ProviderOptionRule = {
	id: "provider.routing.glm-thinking",
	phase: "model-overlay",
	description: "Providers routed to the GLM thinking format use thinking.type.",
	applies: usesGlmThinkingProviderRouting,
	suppresses: { genericThinking: true },
	build: (input) =>
		buildNativeGlmThinkingProviderOptionsPatch(
			input.request,
			input.providerOptionsKey,
		),
};

const miniMaxThinkingRule: ProviderOptionRule = {
	id: "provider.routing.minimax-thinking",
	phase: "model-overlay",
	description: "Direct MiniMax M3 uses thinking.type adaptive/disabled.",
	applies: usesMiniMaxThinkingProviderRouting,
	suppresses: { genericThinking: true, genericEffort: true },
	build: (input) =>
		buildMiniMaxThinkingProviderOptionsPatch(
			input.request,
			input.providerOptionsKey,
		),
};

const routedGlmReasoningRule: ProviderOptionRule = {
	id: "family.glm.routed-reasoning",
	phase: "model-overlay",
	description:
		"Routed GLM models use the generic reasoning include/exclude shape, not thinking.type.",
	applies: (input) =>
		!usesGlmThinkingProviderRouting(input) &&
		isGlmModel(input.request, input.context),
	suppresses: { genericThinking: true },
	build: (input) =>
		buildRoutedGlmReasoningProviderOptionsPatch(
			input.request,
			input.context,
			input.providerOptionsKey,
			{
				includeProviderBuckets: input.request.providerId !== "openrouter",
			},
		),
};

/**
 * The table is the provider/family behavior matrix. Adding a new exception
 * should mean adding a named rule here, not adding a branch in the composer.
 * Keep model/provider fact detection in `providers/model-facts.ts`; see
 * `sdk/packages/llms/AGENTS.md` for the sources-of-truth boundary.
 */
export const PROVIDER_OPTION_RULES: ReadonlyArray<ProviderOptionRule> = [
	directAnthropicProviderRule,
	directGoogleProviderRule,
	openAiAdapterRule,
	openAiCodexRule,
	genericProviderFanoutRule,
	clineGatewayReasoningRule,
	openRouterReasoningRule,
	clineMiniMaxM3GatewayReasoningRule,
	vercelMiniMaxM3GatewayReasoningRule,
	geminiThinkingRule,
	clineReasoningDisabledThinkingRule,
	kimiK26ThinkingRule,
	deepSeekThinkingRule,
	ollamaReasoningDefaultOnDisableRule,
	nonGlmProviderRoutingSuppressionRule,
	nativeZaiGlmThinkingRule,
	miniMaxThinkingRule,
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
