/**
 * AWS Bedrock Models
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

export const BEDROCK_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("bedrock");

export const BEDROCK_DEFAULT_MODEL =
	Object.keys(BEDROCK_MODELS)[0] ?? "anthropic.claude-sonnet-4-5-20250929-v1:0";

export const BEDROCK_PROVIDER: ModelCollection = {
	provider: {
		id: "bedrock",
		name: "AWS Bedrock",
		description: "Amazon Bedrock managed foundation models",
		protocol: "anthropic",
		defaultModelId: BEDROCK_DEFAULT_MODEL,
		capabilities: ["reasoning", "prompt-cache"],
		env: [
			"AWS_REGION",
			"AWS_ACCESS_KEY_ID",
			"AWS_SECRET_ACCESS_KEY",
			"AWS_SESSION_TOKEN",
		],
		client: "bedrock",
	},
	models: BEDROCK_MODELS,
};
