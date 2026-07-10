import * as vscode from "vscode"
import { EditPreview, type EditPreviewContent } from "@/integrations/editor/EditPreview"
import { Logger } from "@/shared/services/Logger"
import { DIFF_VIEW_URI_SCHEME } from "./VscodeDiffViewProvider"

let nextPreviewId = 1

/**
 * VS Code implementation of the read-only edit preview: a `vscode.diff` tab whose
 * BOTH sides are virtual `cline-diff` documents (content carried in the URI query,
 * served by the TextDocumentContentProvider registered in extension.ts). The real
 * file is never opened or modified, so previews of the same file can't interfere
 * with each other, and closing is a precise tab match — never the actual file.
 */
export class VscodeEditPreview extends EditPreview {
	private leftUri: vscode.Uri | undefined
	private rightUri: vscode.Uri | undefined

	override async open(content: EditPreviewContent): Promise<void> {
		// A unique fragment per preview keeps same-file (even same-content) previews in
		// distinct tabs and lets close() match exactly the tab this instance opened.
		const previewId = `cline-edit-preview-${nextPreviewId++}`
		this.leftUri = vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${content.displayPath}`).with({
			query: Buffer.from(content.leftContent).toString("base64"),
			fragment: `${previewId}-left`,
		})
		this.rightUri = vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${content.displayPath}`).with({
			query: Buffer.from(content.rightContent).toString("base64"),
			fragment: `${previewId}-right`,
		})
		await vscode.commands.executeCommand("vscode.diff", this.leftUri, this.rightUri, content.title, {
			preview: false,
		})
	}

	override async close(): Promise<void> {
		const leftUri = this.leftUri
		const rightUri = this.rightUri
		this.leftUri = undefined
		this.rightUri = undefined
		if (!leftUri || !rightUri) {
			return
		}
		try {
			const tabs = vscode.window.tabGroups.all
				.flatMap((group) => group.tabs)
				.filter(
					(tab) =>
						tab.input instanceof vscode.TabInputTextDiff &&
						tab.input.original?.toString() === leftUri.toString() &&
						tab.input.modified?.toString() === rightUri.toString(),
				)
			for (const tab of tabs) {
				await vscode.window.tabGroups.close(tab)
			}
		} catch (error) {
			Logger.warn(`[VscodeEditPreview] Failed to close edit preview tab: ${error}`)
		}
	}
}
