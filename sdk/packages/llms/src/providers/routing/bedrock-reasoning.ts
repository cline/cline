import type {
	GatewayProviderContext,
	GatewayStreamRequest,
	ReasoningEffort,
} from "@cline/shared";
import {
	getModelReasoningControls,
	isBedrockOpenAiModelId,
} from "../model-facts";

/**
 * Bedrock reasoning routing.
 *
 * Two Bedrock-specific facts keep the portable AI SDK `reasoning` option from
 * being the right wire path for every Bedrock model:
 *
 * 1. `@ai-sdk/amazon-bedrock` translates the portable effort into
 *    `additionalModelRequestFields.reasoningConfig` for every model it does
 *    not recognise as Anthropic or OpenAI, and the Converse API rejects that
 *    field for models without reasoning support
 *    ("reasoningConfig: Extra inputs are not permitted"). So the effort must
 *    only be forwarded when the catalog advertises reasoning controls for the
 *    model — provisioned/application inference-profile ARNs and other
 *    unlisted ids get none.
 *
 * 2. The adapter recognises OpenAI models with `modelId.startsWith("openai.")`.
 *    Cline routes those through geo/global inference profiles
 *    (`us.openai.gpt-…`, `global.openai.gpt-…`), which fail that check and fall
 *    into the generic `reasoningConfig` branch — OpenAI models on Bedrock answer
 *    "Unknown parameter: 'reasoningConfig'". For them the effort is written
 *    directly as `additionalModelRequestFields.reasoning_effort`, the shape the
 *    adapter itself uses for bare `openai.` ids.
 *
 * Tracked in cline/cline#14095.
 */

/** True when the catalog advertises at least one user-facing reasoning control. */
export function bedrockModelAdvertisesReasoning(
	context: GatewayProviderContext,
): boolean {
	const controls = getModelReasoningControls(context.model.reasoningOptions);
	return (
		controls !== undefined &&
		(controls.effort !== undefined ||
			controls.budget !== undefined ||
			controls.toggle ||
			controls.supportsDefault)
	);
}

/**
 * Whether the request may use the AI SDK's portable top-level `reasoning`
 * option. Non-Bedrock requests are unaffected; Bedrock requests use it only
 * for catalog models with advertised reasoning controls that the adapter
 * translates correctly (everything except OpenAI models).
 */
export function usesBedrockPortableReasoning(
	request: GatewayStreamRequest,
	context: GatewayProviderContext | undefined,
): boolean {
	if (request.providerId !== "bedrock" || context === undefined) {
		return true;
	}
	return (
		bedrockModelAdvertisesReasoning(context) &&
		!isBedrockOpenAiModelId(request.modelId)
	);
}

/**
 * OpenAI models on Bedrock accept OpenAI's `reasoning_effort` vocabulary;
 * "max" is Anthropic's word for the top tier.
 */
export function toBedrockOpenAiReasoningEffort(
	effort: ReasoningEffort,
): string {
	return effort === "max" ? "xhigh" : effort;
}
