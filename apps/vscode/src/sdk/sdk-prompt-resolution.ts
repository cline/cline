export type PluginCommandResolutionMode = "execute" | "reject" | "ignore"

export interface PromptResolutionOptions {
	pluginCommands?: PluginCommandResolutionMode
	/**
	 * Whether the submission carried images or files. Plugin command handlers
	 * accept only text, so a handled command with attachments warns the user
	 * that the attachments were not passed to the plugin.
	 */
	hasAttachments?: boolean
}
