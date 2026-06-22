import type { ExtensionState } from "@shared/ExtensionMessage"

/**
 * Builds the ExtensionState object to push to the webview.
 * Inert stub: returns an empty state.
 */
export async function getStateToPostToWebview(_controller: {
	task?: any
	stateManager: any
	mcpHub?: any
	backgroundCommandRunning?: boolean
	backgroundCommandTaskId?: string
	workspaceManager?: any
}): Promise<ExtensionState> {
	return {} as ExtensionState
}
