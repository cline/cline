/**
 * OCA Provider
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

export const DEFAULT_INTERNAL_OCA_BASE_URL =
	"https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm";
export const DEFAULT_EXTERNAL_OCA_BASE_URL =
	"https://code.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm";

// Falls back to the legacy default when a generated catalog does not yet include OCA.
export const OCA_DEFAULT_MODEL = "anthropic/claude-3-7-sonnet-20250219";
export const OCA_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("oca");

export const OCA_PROVIDER: ModelCollection = {
	provider: {
		id: "oca",
		name: "Oracle Code Assist",
		description: "Oracle Code Assist (OCA) LiteLLM gateway",
		protocol: "openai-chat",
		baseUrl: DEFAULT_EXTERNAL_OCA_BASE_URL,
		defaultModelId: Object.keys(OCA_MODELS)[0] ?? OCA_DEFAULT_MODEL,
		capabilities: ["reasoning", "prompt-cache", "tools"],
		env: ["OCA_API_KEY"],
	},
	models: OCA_MODELS,
};
