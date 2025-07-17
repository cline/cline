import { getHostBridgeProvider } from "@/hosts/host-providers"

/**
 * Get the active text editor via host bridge
 * @returns Promise resolving to active text editor info or null if no active editor
 * @throws Error if the operation fails
 */
export async function getActiveTextEditor(): Promise<{
	documentPath?: string
	viewColumn?: number
	languageId?: string
	selection?: {
		startLine: number
		startCharacter: number
		endLine: number
		endCharacter: number
	}
	isActive: boolean
} | null> {
	try {
		const activeEditorInfo = await getHostBridgeProvider().windowClient.getActiveTextEditor({})

		if (activeEditorInfo && activeEditorInfo.isActive) {
			return {
				documentPath: activeEditorInfo.documentPath,
				viewColumn: activeEditorInfo.viewColumn,
				languageId: activeEditorInfo.languageId,
				selection: activeEditorInfo.selection
					? {
							startLine: activeEditorInfo.selection.startLine,
							startCharacter: activeEditorInfo.selection.startCharacter,
							endLine: activeEditorInfo.selection.endLine,
							endCharacter: activeEditorInfo.selection.endCharacter,
						}
					: undefined,
				isActive: true,
			}
		}

		return null
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to get active text editor: ${errorMessage}`)
	}
}

/**
 * Get all visible text editors via host bridge
 * @returns Promise resolving to array of visible text editor info
 * @throws Error if the operation fails
 */
export async function getVisibleTextEditors(): Promise<
	{
		documentPath: string
		viewColumn?: number
		languageId?: string
		selection?: {
			startLine: number
			startCharacter: number
			endLine: number
			endCharacter: number
		}
		isActive: boolean
	}[]
> {
	try {
		const editorsInfo = await getHostBridgeProvider().windowClient.getVisibleTextEditors({})

		return editorsInfo.editors.map((editor) => ({
			documentPath: editor.documentPath,
			viewColumn: editor.viewColumn,
			languageId: editor.languageId,
			selection: editor.selection
				? {
						startLine: editor.selection.startLine,
						startCharacter: editor.selection.startCharacter,
						endLine: editor.selection.endLine,
						endCharacter: editor.selection.endCharacter,
					}
				: undefined,
			isActive: editor.isActive,
		}))
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to get visible text editors: ${errorMessage}`)
	}
}
