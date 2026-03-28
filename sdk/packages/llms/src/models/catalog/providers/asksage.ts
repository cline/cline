/**
 * AskSage Provider
 */

import type { ModelCollection } from "../../types/index";

export const ASKSAGE_PROVIDER: ModelCollection = {
	provider: {
		id: "asksage",
		name: "AskSage",
		description: "AskSage platform",
		protocol: "openai-chat",
		baseUrl: "https://api.asksage.ai/server",
		defaultModelId: "gpt-4o",
		capabilities: ["tools"],
		env: ["ASKSAGE_API_KEY"],
	},
	models: {},
};
