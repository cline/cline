import { isClineProvider } from "@cline/shared";
import { OLLAMA_DEFAULT_CONTEXT_WINDOW } from "../builtins";
import {
	getModelReasoningControls,
	isDeepSeekFamily,
	isGlmModel,
	isKimiK26Family as isKimiK26FamilyFact,
	isMiniMaxM3Model,
	isMoonshotKimiModelIdFallback,
	providerReasoningRouteMatches,
} from "../model-facts";
import { buildGatewayReasoningOptions } from "./anthropic-compatible";
import { buildOpenAINativeProviderOptions } from "./generic-compatible";
import {
	buildNativeGlmThinkingProviderOptionsPatch,
	buildRoutedGlmReasoningProviderOptionsPatch,
} from "./glm-thinking";
import { buildMiniMaxThinkingProviderOptionsPatch } from "./minimax-thinking";
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

function buildGeminiThinkingConfig(input: ProviderOptionBuildInput) {
	const budgetTokens = input.request.reasoning?.budgetTokens;
	if (typeof budgetTokens === "number") {
		return {
			thinkingBudget: budgetTokens,
			includeThoughts: true,
		};
	}
	return undefined;
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
		"Direct Google owns the google bucket used for exact reasoning budgets.",
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
			...(["openai", "openai-native"].includes(input.request.providerId)
				? buildOpenAINativeProviderOptions()
				: {}),
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
	suppresses: { genericThinking: true },
	build: (input) =>
		buildReasoningPatchForProvider(
			input,
			buildOpenRouterReasoningOptions(input.request, input.context),
		),
};

const clineMiniMaxM3GatewayReasoningRule: ProviderOptionRule = {
	id: "provider.cline.minimax-m3.gateway-reasoning",
	phase: "provider-reasoning",
	description:
		"Cline-routed MiniMax M3 keeps the gateway reasoning shape instead of leaking generic thinking.",
	applies: (input) =>
		isClineProvider(input.request.providerId) && isMiniMaxM3(input),
	suppresses: { genericThinking: true },
	build: () => undefined,
};

const vercelReasoningRule: ProviderOptionRule = {
	id: "provider.vercel-ai-gateway.reasoning",
	phase: "provider-reasoning",
	description:
		"Vercel maps advertised toggle and budget controls to its gateway reasoning shape.",
	applies: (input) => {
		if (input.request.providerId !== "vercel-ai-gateway") {
			return false;
		}
		const controls = getModelReasoningControls(
			input.context.model.reasoningOptions,
		);
		return (
			(controls?.toggle === true &&
				typeof input.request.reasoning?.enabled === "boolean") ||
			(controls?.budget !== undefined &&
				typeof input.request.reasoning?.budgetTokens === "number") ||
			isMiniMaxM3(input)
		);
	},
	suppresses: { genericThinking: true },
	build: (input) => {
		const reasoning = input.request.reasoning;
		if (!reasoning) {
			return undefined;
		}
		const gatewayReasoning =
			typeof reasoning.budgetTokens === "number"
				? { max_tokens: reasoning.budgetTokens }
				: reasoning.enabled === false
					? { exclude: true }
					: reasoning.enabled === true
						? { enabled: true }
						: undefined;
		return gatewayReasoning
			? buildReasoningPatchForProvider(input, gatewayReasoning)
			: undefined;
	},
};

const directMoonshotReasoningRule: ProviderOptionRule = {
	id: "provider.moonshot.toggle",
	phase: "provider-reasoning",
	description:
		"Direct Moonshot maps advertised toggle controls to thinking.type.",
	applies: (input) =>
		input.request.providerId === "moonshot" &&
		getModelReasoningControls(input.context.model.reasoningOptions)?.toggle ===
			true &&
		typeof input.request.reasoning?.enabled === "boolean",
	suppresses: { genericThinking: true },
	build: (input) =>
		buildThinkingPatch({
			providerId: input.request.providerId,
			providerOptionsKey: input.providerOptionsKey,
			thinkingType: input.request.reasoning?.enabled ? "enabled" : "disabled",
		}),
};

const fireworksReasoningRule: ProviderOptionRule = {
	id: "provider.fireworks.reasoning-budget",
	phase: "provider-reasoning",
	description:
		"Fireworks uses its native thinking object for exact token budgets.",
	applies: (input) =>
		input.request.providerId === "fireworks" &&
		typeof input.request.reasoning?.budgetTokens === "number",
	suppresses: { genericThinking: true },
	build: (input) => {
		const reasoning = input.request.reasoning;
		return buildProviderAndAliasPatch({
			providerId: input.request.providerId,
			providerOptionsKey: input.providerOptionsKey,
			bucketOptions: {
				thinking: {
					type: "enabled",
					budget_tokens: reasoning?.budgetTokens,
				},
			},
		});
	},
};

const togetherReasoningToggleRule: ProviderOptionRule = {
	id: "provider.together.toggle",
	phase: "provider-reasoning",
	description: "Together maps advertised toggle controls to reasoning.enabled.",
	applies: (input) =>
		input.request.providerId === "together" &&
		getModelReasoningControls(input.context.model.reasoningOptions)?.toggle ===
			true &&
		typeof input.request.reasoning?.enabled === "boolean",
	suppresses: { genericThinking: true },
	build: (input) =>
		buildReasoningPatchForProvider(input, {
			enabled: input.request.reasoning?.enabled,
		}),
};

const geminiThinkingRule: ProviderOptionRule = {
	id: "provider.google-gemini.thinking-config",
	phase: "provider",
	description:
		"Google/Gemini/Vertex uses thinkingConfig only for exact token budgets.",
	suppresses: { genericThinking: true },
	applies: (input) =>
		(input.request.providerId === "google" ||
			input.request.providerId === "gemini" ||
			input.request.providerId === "vertex") &&
		typeof input.request.reasoning?.budgetTokens === "number",
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
	description: "Kimi K2.6 uses thinking.type only for explicit disable.",
	applies: (input) =>
		isKimiK26Family(input) &&
		input.request.providerId !== "openrouter" &&
		input.request.reasoning?.enabled === false,
	suppresses: { genericThinking: true },
	build: (input) =>
		buildThinkingPatch({
			providerId: input.request.providerId,
			providerOptionsKey: input.providerOptionsKey,
			thinkingType: "disabled",
		}),
};

const deepSeekThinkingRule: ProviderOptionRule = {
	id: "family.deepseek.thinking",
	phase: "model-family",
	description:
		"DeepSeek models use thinking.type only for explicit reasoning enabled/disabled.",
	applies: (input) =>
		input.request.providerId !== "openrouter" &&
		isDeepSeekModelOrProviderDefault(input) &&
		input.target !== "ollama",
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

const ollamaNativeOptionsRule: ProviderOptionRule = {
	id: "provider.ollama.native-options",
	phase: "provider-reasoning",
	description:
		"Ollama receives only its context window through native provider options; reasoning is top-level.",
	applies: (input) => input.target === "ollama",
	suppresses: { genericThinking: true },
	build: (input) => {
		const contextWindow =
			input.context.model.contextWindow ??
			input.context.model.maxInputTokens ??
			OLLAMA_DEFAULT_CONTEXT_WINDOW;
		const numCtx =
			typeof contextWindow === "number" &&
			Number.isFinite(contextWindow) &&
			contextWindow > 0
				? Math.floor(contextWindow)
				: OLLAMA_DEFAULT_CONTEXT_WINDOW;
		const bucketOptions = {
			options: { num_ctx: numCtx },
		};
		return {
			ollama: bucketOptions,
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
	suppresses: { genericThinking: true },
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
	vercelReasoningRule,
	directMoonshotReasoningRule,
	fireworksReasoningRule,
	geminiThinkingRule,
	clineReasoningDisabledThinkingRule,
	kimiK26ThinkingRule,
	deepSeekThinkingRule,
	ollamaNativeOptionsRule,
	nonGlmProviderRoutingSuppressionRule,
	nativeZaiGlmThinkingRule,
	miniMaxThinkingRule,
	routedGlmReasoningRule,
	togetherReasoningToggleRule,
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
