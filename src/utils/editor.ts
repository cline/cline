import * as vscode from "vscode"
import { getHostBridgeProvider } from "@/hosts/host-providers"
import { Metadata } from "@/shared/proto/common"

/**
 * Get the active text editor, preferring the host bridge API with fallback to VSCode API
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
		// Try to get the active text editor via the host bridge
		const activeEditorInfo = await getHostBridgeProvider().windowClient.getActiveTextEditor({
			metadata: Metadata.create(),
		})

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

		// No active editor available, return null instead of throwing error
		return null
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to get active text editor: ${errorMessage}`)
	}
}

/**
 * Get the active text editor compatible with VSCode API (fallback only)
 */
export function getActiveTextEditorVSCode(): vscode.TextEditor | undefined {
	return vscode.window.activeTextEditor
}

/**
 * Get all visible text editors, preferring the host bridge API with fallback to VSCode API
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
		// Try to get the visible text editors via the host bridge
		const editorsInfo = await getHostBridgeProvider().windowClient.getVisibleTextEditors({
			metadata: Metadata.create(),
		})

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

/**
 * Get visible text editors compatible with VSCode API (fallback only)
 */
export function getVisibleTextEditorsVSCode(): readonly vscode.TextEditor[] {
	return vscode.window.visibleTextEditors
}
