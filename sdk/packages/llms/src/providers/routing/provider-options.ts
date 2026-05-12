import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import {
	buildAnthropicProviderOptions,
	isAnthropicCompatibleModel,
	resolveAnthropicReasoningRequestPolicy,
	resolveModelFamily,
} from "./anthropic-compatible";
import { buildCompatibleProviderOptions } from "./generic-compatible";
import {
	buildProviderOptionRulePatches,
	matchProviderOptionRules,
	PROVIDER_OPTION_RULES,
	resolveProviderOptionMatchInput,
	resolveProviderOptionSuppressions,
} from "./provider-option-rules";
import {
	type AiSdkProviderOptionsTarget,
	inferProviderOptionsTarget,
} from "./provider-options-types";
import { type ProviderOptionsPatch, toProviderOptionsKey } from "./utils";

export type { AiSdkProviderOptionsTarget } from "./provider-options-types";
export type { ProviderOptionsPatch } from "./utils";

/** Merge patches in order. Later patches override earlier ones per bucket key. */
export function mergeProviderOptionPatches(
	patches: ReadonlyArray<ProviderOptionsPatch | undefined>,
): Record<string, unknown> {
	const result: Record<string, Record<string, unknown>> = {};
	for (const patch of patches) {
		if (!patch) {
			continue;
		}
		for (const [bucket, options] of Object.entries(patch)) {
			result[bucket] = { ...(result[bucket] ?? {}), ...options };
		}
	}
	return result;
}

function buildBaseProviderOptionsPatch(
	compatibleOptions: Record<string, unknown>,
	anthropicOptions: Record<string, unknown>,
): ProviderOptionsPatch {
	return {
		anthropic: anthropicOptions,
		openaiCompatible: compatibleOptions,
	};
}

/**
 * Compose AI SDK `providerOptions` from named provider/model-family rules.
 *
 * The rule table in `provider-option-rules.ts` is the behavior matrix for
 * special providers and model families. Keep the composer boring: build shared
 * buckets once, then merge ordered rule patches.
 */
export function composeAiSdkProviderOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
	target: AiSdkProviderOptionsTarget = inferProviderOptionsTarget(
		request.providerId,
	),
): Record<string, unknown> {
	const providerOptionsKey = toProviderOptionsKey(request.providerId);
	const family = resolveModelFamily(context);
	const isAnthropicCompatibleModelId = isAnthropicCompatibleModel({
		modelId: request.modelId,
		family,
	});
	const anthropicReasoningPolicy = isAnthropicCompatibleModelId
		? resolveAnthropicReasoningRequestPolicy(request, context)
		: undefined;
	const matchInput = resolveProviderOptionMatchInput({
		request,
		context,
		providerOptionsKey,
		target,
		isAnthropicCompatibleModelId,
		anthropicReasoningPolicyKind: anthropicReasoningPolicy?.kind,
	});
	const matchedRules = matchProviderOptionRules(
		PROVIDER_OPTION_RULES,
		matchInput,
	);
	const suppressions = resolveProviderOptionSuppressions(matchedRules);
	const compatibleOptions = buildCompatibleProviderOptions({
		request,
		context,
		isAnthropicCompatibleModelId,
		target,
		suppressions,
	});
	const anthropicOptions = buildAnthropicProviderOptions(request, context);
	const buildInput = {
		...matchInput,
		compatibleOptions,
		anthropicOptions,
		suppressions,
	};

	return mergeProviderOptionPatches([
		buildBaseProviderOptionsPatch(compatibleOptions, anthropicOptions),
		...buildProviderOptionRulePatches(matchedRules, buildInput),
	]);
}
