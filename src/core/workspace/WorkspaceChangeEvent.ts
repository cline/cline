/**
 * Platform-agnostic workspace change event
 * Both VSCode and JetBrains convert their native events to this format
 */
export interface WorkspaceChangeEvent {
	/**
	 * Workspaces that were added
	 */
	added: Array<{
		path: string // Absolute file system path
		name: string // Display name
	}>
	/**
	 * Workspaces that were removed
	 */
	removed: Array<{
		path: string // Absolute file system path
		name: string // Display name
	}>
}
