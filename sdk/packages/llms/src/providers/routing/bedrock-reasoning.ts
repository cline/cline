import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { getModelReasoningControls } from "../model-facts";

/**
 * Bedrock reasoning routing.
 *
 * `@ai-sdk/amazon-bedrock` translates the AI SDK's portable top-level
 * `reasoning` option into the wire shape each Bedrock model family accepts
 * (Anthropic `output_config.effort` / thinking, OpenAI `reasoning.effort`,
 * gpt-oss `reasoning_effort`) and falls back to
 * `additionalModelRequestFields.reasoningConfig` for everything else. The
 * Converse API rejects that fallback field for models without reasoning
 * support ("reasoningConfig: Extra inputs are not permitted"), so the effort
 * must only be forwarded when the catalog advertises reasoning controls for
 * the model. Provisioned/application inference-profile ARNs and other
 * unlisted ids advertise nothing and get no reasoning fields at all.
 *
 * OpenAI models routed through inference profiles (`us.openai.gpt-…`,
 * `global.openai.gpt-…`) used to hit the same fallback because the adapter
 * only recognised bare `openai.` ids; adapter 5.0.65+ recognises the prefixed
 * form, so they stay on the portable path here.
 *
 * Tracked in cline/cline#14095 and cline/cline#14451.
 */

/** True when the catalog advertises at least one user-facing reasoning control. */
function bedrockModelAdvertisesReasoning(
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
 * for catalog models with advertised reasoning controls.
 */
export function usesBedrockPortableReasoning(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): boolean {
	return (
		request.providerId !== "bedrock" || bedrockModelAdvertisesReasoning(context)
	);
}
