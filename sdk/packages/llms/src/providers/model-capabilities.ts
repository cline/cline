import type {
	GatewayModelCapability,
	ModelCapability,
	ModelInfo,
} from "@cline/shared";

/**
 * The one mapping from catalog capabilities to gateway capabilities.
 *
 * Every `ModelCapability` names its gateway counterpart, or `null` when the
 * gateway draws no distinction and the capability implies nothing beyond plain
 * text generation. Because the key type derives from `ModelCapabilitySchema`,
 * extending that schema without deciding the mapping is a type error rather
 * than a silent omission — which is how the hand-written `switch` statements
 * this replaces drifted apart.
 *
 * The gateway's `audio` capability has no counterpart here on purpose: no
 * catalog capability describes audio input, which travels through
 * `ModelInfo.modalities` instead.
 */
const GATEWAY_CAPABILITY_BY_MODEL_CAPABILITY: Readonly<
	Record<ModelCapability, GatewayModelCapability | null>
> = {
	images: "images",
	video: null,
	tools: "tools",
	streaming: null,
	"prompt-cache": "prompt-cache",
	reasoning: "reasoning",
	"reasoning-effort": null,
	"computer-use": null,
	"global-endpoint": null,
	structured_output: "structured-output",
	temperature: null,
	files: null,
};

/**
 * Translates catalog capabilities into gateway capabilities.
 *
 * Every gateway model accepts text, so `"text"` is always present and leads
 * the result. Capabilities outside `ModelCapabilitySchema` reach this function
 * from dynamic provider listings typed as plain strings; they contribute only
 * the implied text capability rather than being passed through unvalidated.
 *
 * A missing or empty list yields `undefined`, matching `modelHasCapability`'s
 * treatment of both as "no capability signal" so downstream gates apply their
 * own defaults instead of reading an authoritative denial.
 */
export function toGatewayModelCapabilities(
	capabilities: ModelInfo["capabilities"] | readonly string[] | undefined,
): GatewayModelCapability[] | undefined {
	if (!capabilities?.length) {
		return undefined;
	}

	const mapped = new Set<GatewayModelCapability>(["text"]);
	for (const capability of capabilities) {
		const gatewayCapability =
			GATEWAY_CAPABILITY_BY_MODEL_CAPABILITY[capability as ModelCapability];
		if (gatewayCapability) {
			mapped.add(gatewayCapability);
		}
	}
	return [...mapped];
}
