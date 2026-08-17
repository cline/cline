/** Tools that require an explicit global opt-in before they are available. */
export const OPT_IN_TOOL_NAMES = ["web_search", "generate_media"] as const;

export type OptInToolName = (typeof OPT_IN_TOOL_NAMES)[number];

export interface OptInToolSetting {
	enabled: boolean;
}

export type OptInToolSettings = Partial<
	Record<OptInToolName, OptInToolSetting>
>;
