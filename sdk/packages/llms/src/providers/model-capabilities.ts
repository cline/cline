import type { GatewayModelDefinition, ModelInfo } from "@cline/shared";

/**
 * Converts catalog capabilities into gateway capabilities without erasing
 * whether the catalog supplied capability metadata. Gateway models always
 * accept text; an absent result means the model's other capabilities are
 * unknown, while `["text"]` means they are known to include no other mapped
 * capability.
 */
export function toGatewayModelCapabilities(
	capabilities: ModelInfo["capabilities"],
): GatewayModelDefinition["capabilities"] {
	if (capabilities === undefined) {
		return undefined;
	}

	const mapped = new Set<
		NonNullable<GatewayModelDefinition["capabilities"]>[number]
	>(["text"]);
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

	return [...mapped];
}
