import type { GatewayModelCapabilities, ModelInfo } from "@cline/shared";

/**
 * Converts catalog capabilities into gateway capabilities without erasing
 * whether the catalog supplied capability metadata. Gateway models always
 * accept text; an absent result means the model's other capabilities are
 * unknown, while `["text"]` means they are known to include no other mapped
 * capability.
 */
export function toGatewayModelCapabilities(
	capabilities: ModelInfo["capabilities"],
): GatewayModelCapabilities | undefined {
	if (capabilities === undefined) {
		return undefined;
	}

	const mapped = new Set<Exclude<GatewayModelCapabilities[number], "text">>();
	for (const capability of capabilities) {
		switch (capability) {
			case "tools":
			case "reasoning":
			case "prompt-cache":
			case "images":
				mapped.add(capability);
				break;
			case "structured_output":
				mapped.add("structured-output");
				break;
		}
	}

	return ["text", ...mapped];
}
