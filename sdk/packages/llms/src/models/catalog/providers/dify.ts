/**
 * Dify Provider
 */

import type { ModelCollection } from "../../types/index";

export const DIFY_PROVIDER: ModelCollection = {
	provider: {
		id: "dify",
		name: "Dify",
		description: "Dify workflow/application provider via AI SDK",
		protocol: "openai-chat",
		defaultModelId: "default",
		env: ["DIFY_API_KEY"],
	},
	models: {},
};
