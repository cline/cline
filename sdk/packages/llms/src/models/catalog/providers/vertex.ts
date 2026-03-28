/**
 * Google Vertex AI Models
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

export const VERTEX_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("vertex");

const VERTEX_MODEL_IDS = Object.keys(VERTEX_MODELS);
const DEFAULT_GEMINI_VERTEX_MODEL = VERTEX_MODEL_IDS.find(
	(id) => !id.includes("claude"),
);

export const VERTEX_DEFAULT_MODEL =
	DEFAULT_GEMINI_VERTEX_MODEL ?? VERTEX_MODEL_IDS[0] ?? "gemini-3-pro";

export const VERTEX_PROVIDER: ModelCollection = {
	provider: {
		id: "vertex",
		name: "Google Vertex AI",
		description: "Google Cloud Vertex AI (Gemini and partner models)",
		protocol: "gemini",
		defaultModelId: VERTEX_DEFAULT_MODEL,
		capabilities: ["reasoning", "prompt-cache"],
		env: [
			"GCP_PROJECT_ID",
			"GOOGLE_CLOUD_PROJECT",
			"GOOGLE_APPLICATION_CREDENTIALS",
			"GEMINI_API_KEY",
			"GOOGLE_API_KEY",
		],
	},
	models: VERTEX_MODELS,
};
