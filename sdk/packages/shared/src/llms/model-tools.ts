/** Provider-executed tools requested from the selected language model. */
export const MODEL_TOOL_NAMES = ["web_search"] as const;

export type ModelToolName = (typeof MODEL_TOOL_NAMES)[number];

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

/**
 * A tool executed by the model provider as part of inference. Unlike an
 * AgentTool, it has no local executor or approval lifecycle.
 */
export type ModelTool = WebSearchModelTool;

export interface ModelToolSetting {
	enabled: boolean;
}

export type ModelToolSettings = Partial<
	Record<ModelToolName, ModelToolSetting>
>;
