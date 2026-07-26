import type {
	GatewayModelDefinition,
	GatewayProviderManifest,
} from "@cline/shared";
import {
	BEDROCK_DEFAULT_MODEL_ID,
	BEDROCK_MODELS,
} from "../catalog/bedrock";
import type { ModelCollection, ModelInfo } from "../catalog/types";
import type { BuiltinSpec } from "./builtin-types";

export type { BuiltinSpec, ProviderFamily } from "./builtin-types";

function toGatewayModel(model: ModelInfo): GatewayModelDefinition {
	return {
		id: model.id,
		name: model.name ?? model.id,
		providerId: "bedrock",
		description: model.description,
		contextWindow: model.contextWindow,
		maxInputTokens: model.maxInputTokens,
		maxOutputTokens: model.maxTokens,
		capabilities: model.capabilities?.flatMap((capability) => {
			switch (capability) {
				case "tools":
				case "reasoning":
				case "prompt-cache":
				case "images":
					return [capability];
				case "structured_output":
					return ["structured-output" as const];
				default:
					return ["text" as const];
			}
		}),
		metadata: {
			family: model.family,
			pricing: model.pricing,
		},
	};
}

export const BUILTIN_SPECS: readonly BuiltinSpec[] = [
	{
		id: "bedrock",
		name: "AWS Bedrock",
		description: "Amazon Bedrock managed foundation models",
		family: "bedrock",
		capabilities: ["tools", "reasoning", "prompt-cache", "streaming"],
		modelsProviderId: "bedrock",
		defaultModelId: BEDROCK_DEFAULT_MODEL_ID,
		modelsFactory: () => BEDROCK_MODELS,
		env: ["node"],
		metadata: {
			routing: {
				promptCache: {
					format: "anthropic-cache-control",
					routes: [{ matcher: "anthropic-compatible" }],
				},
				reasoning: {
					format: "anthropic-thinking",
					routes: [{ matcher: "anthropic-compatible" }],
				},
			},
		},
	},
];

export function toManifest(spec: BuiltinSpec): GatewayProviderManifest {
	return {
		id: "bedrock",
		name: spec.name,
		description: spec.description,
		defaultModelId: spec.defaultModelId,
		models: Object.values(spec.modelsFactory()).map(toGatewayModel),
		capabilities: spec.capabilities,
		env: spec.env,
		metadata: spec.metadata,
	};
}

export const BUILTIN_PROVIDER_COLLECTION_LIST: ModelCollection[] = [
	{
		provider: {
			id: "bedrock",
			name: "AWS Bedrock",
			description: "Amazon Bedrock managed foundation models",
			defaultModelId: BEDROCK_DEFAULT_MODEL_ID,
			capabilities: ["tools", "reasoning", "prompt-cache", "streaming"],
			client: "bedrock",
			source: "system",
		},
		models: BEDROCK_MODELS,
	},
];
