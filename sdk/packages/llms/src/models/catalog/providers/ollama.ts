/**
 * Ollama Provider
 */

import type { ModelCollection } from "../../types/index";

export const OLLAMA_PROVIDER: ModelCollection = {
	provider: {
		id: "ollama",
		name: "Ollama",
		description: "Ollama Cloud and local LLM hosting",
		protocol: "openai-chat",
		baseUrl: "http://localhost:11434/v1",
		defaultModelId: "llama3.2",
		env: ["OLLAMA_API_KEY"],
		client: "openai-compatible",
	},
	models: {},
};
