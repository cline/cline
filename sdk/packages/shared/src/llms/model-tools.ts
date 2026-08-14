/** Provider-executed tools requested from the selected language model. */
export const MODEL_TOOL_NAMES = ["web_search", "image_generation"] as const;

export const CONFIGURABLE_MODEL_TOOL_NAMES = ["web_search"] as const;

export type ModelToolName = (typeof MODEL_TOOL_NAMES)[number];
export type ConfigurableModelToolName =
	(typeof CONFIGURABLE_MODEL_TOOL_NAMES)[number];

export interface WebSearchModelTool {
	name: "web_search";
	maxUses?: number;
	allowedDomains?: string[];
	blockedDomains?: string[];
	userLocation?: {
		country?: string;
		region?: string;
		city?: string;
		timezone?: string;
	};
}

export interface ImageGenerationModelTool {
	name: "image_generation";
	outputFormat?: "png" | "jpeg" | "webp";
}

/**
 * A tool executed by the model provider as part of inference. Unlike an
 * AgentTool, it has no local executor or approval lifecycle.
 */
export type ModelTool = WebSearchModelTool | ImageGenerationModelTool;

export interface ModelToolSetting {
	enabled: boolean;
}

export type ModelToolSettings = Partial<
	Record<ConfigurableModelToolName, ModelToolSetting>
>;
