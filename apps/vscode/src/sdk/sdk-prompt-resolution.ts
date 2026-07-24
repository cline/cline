export type PluginCommandResolutionMode = "execute" | "reject" | "ignore"

export interface PromptResolutionOptions {
	pluginCommands?: PluginCommandResolutionMode
}
