/**
 * HiCap Provider
 */

import type { ModelCollection } from "../../types/index";

export const HICAP_PROVIDER: ModelCollection = {
	provider: {
		id: "hicap",
		name: "HiCap",
		description: "HiCap AI platform",
		protocol: "openai-chat",
		baseUrl: "https://api.hicap.ai/v1",
		defaultModelId: "hicap-pro",
		env: ["HICAP_API_KEY"],
	},
	models: {},
};
