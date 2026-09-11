import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { buildAnthropicProviderOptions } from "./anthropic-compatible";
import { buildCompatibleProviderOptions } from "./generic-compatible";
import { withoutPortableReasoning } from "./portable-reasoning";
import {
	buildProviderOptionRulePatches,
	matchProviderOptionRules,
	PROVIDER_OPTION_RULES,
	resolveProviderOptionSuppressions,
} from "./provider-option-rules";
import {
	type AiSdkProviderOptionsTarget,
	inferProviderOptionsTarget,
	type ProviderOptionMatchInput,
} from "./provider-options-types";
import { normalizeReasoningRequest } from "./reasoning-options";
import { type ProviderOptionsPatch, toProviderOptionsKey } from "./utils";

export type { AiSdkProviderOptionsTarget } from "./provider-options-types";
export type { ProviderOptionsPatch } from "./utils";

/**
 * Merge patches in order. Later patches override earlier ones per bucket key;
 * nested object values are replaced, not deep-merged.
 */
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
 *
 * Routing ownership boundary:
 * - Gateway model capabilities say what a model can do, such as reasoning.
 * - Model metadata records stable known-model facts, such as
 *   `reasoningDefaultOn`.
 * - Provider metadata records stable provider policy, such as prompt caching.
 * - Provider-option rules encode only non-portable request intent into
 *   provider wire formats, such as exact budgets and native toggle objects.
 */
export function composeAiSdkProviderOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
	target: AiSdkProviderOptionsTarget = inferProviderOptionsTarget(
		request.providerId,
	),
): Record<string, unknown> {
	const normalizedRequest = normalizeReasoningRequest(
		withoutPortableReasoning(request),
		context,
	);
	const providerOptionsKey = toProviderOptionsKey(normalizedRequest.providerId);
	const matchInput: ProviderOptionMatchInput = {
		request: normalizedRequest,
		context,
		providerOptionsKey,
		target,
	};
	const matchedRules = matchProviderOptionRules(
		PROVIDER_OPTION_RULES,
		matchInput,
	);
	const suppressions = resolveProviderOptionSuppressions(matchedRules);
	const compatibleOptions = buildCompatibleProviderOptions({
		request: normalizedRequest,
		context,
		target,
		suppressions,
	});
	const anthropicOptions = buildAnthropicProviderOptions(
		normalizedRequest,
		context,
	);
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
