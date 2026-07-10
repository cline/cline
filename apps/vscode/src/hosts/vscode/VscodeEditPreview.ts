import * as vscode from "vscode"
import { buildEditPreviewAnimation, EditPreview, type EditPreviewContent } from "@/integrations/editor/EditPreview"
import { Logger } from "@/shared/services/Logger"
import { DecorationController } from "./DecorationController"

export const EDIT_PREVIEW_URI_SCHEME = "cline-edit-preview"

/**
 * Hold at the top of the file — whole doc under the faded overlay, cursor parked on
 * line 0 — before the sweep starts, so the animation unambiguously reads as starting
 * from the top rather than appearing mid-file.
 */
const ANIMATION_START_BEAT_MS = 400
/** Beat between the sweep finishing at the bottom and the reveal of the first change. */
const ANIMATION_END_BEAT_MS = 250
/** Files larger than this skip the animation and render the final diff immediately. */
const MAX_ANIMATED_LINES = 3_000

/**
 * Serves the virtual documents backing edit-preview diff tabs. Mutable (unlike the
 * base64-query `cline-diff` provider) so the right side can be animated: setting new
 * content fires onDidChange and VS Code re-renders the document in place.
 */
class EditPreviewContentStore implements vscode.TextDocumentContentProvider {
	private readonly contents = new Map<string, string>()
	private readonly emitter = new vscode.EventEmitter<vscode.Uri>()
	readonly onDidChange = this.emitter.event

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.contents.get(uri.toString()) ?? ""
	}

	set(uri: vscode.Uri, content: string): void {
		this.contents.set(uri.toString(), content)
		this.emitter.fire(uri)
	}

	delete(uri: vscode.Uri): void {
		this.contents.delete(uri.toString())
	}
}

/** Singleton registered for EDIT_PREVIEW_URI_SCHEME in extension.ts. */
export const editPreviewContentProvider = new EditPreviewContentStore()

let nextPreviewId = 1

/**
 * VS Code implementation of the read-only edit preview: a `vscode.diff` tab whose
 * BOTH sides are virtual documents. The real file is never opened or modified, so
 * previews of the same file can't interfere with each other, and closing is a
 * precise tab match — never the actual file.
 *
 * The right side plays a simulated streaming animation (the legacy yellow
 * faded-overlay/active-line sweep): it opens showing the original content, then the
 * new content types itself in. The SDK only surfaces complete tool input, so this is
 * a deliberate simulation of the legacy feel, not real generation progress.
 */
export class VscodeEditPreview extends EditPreview {
	private leftUri: vscode.Uri | undefined
	private rightUri: vscode.Uri | undefined
	private animationCancelled = false
	private animation: Promise<void> | undefined

	override async open(content: EditPreviewContent): Promise<void> {
		// A unique query per preview keeps same-file (even same-content) previews in
		// distinct tabs and lets close() match exactly the tab this instance opened.
		const previewId = nextPreviewId++
		this.leftUri = vscode.Uri.parse(`${EDIT_PREVIEW_URI_SCHEME}:${content.displayPath}`).with({
			query: `preview-${previewId}-left`,
		})
		this.rightUri = vscode.Uri.parse(`${EDIT_PREVIEW_URI_SCHEME}:${content.displayPath}`).with({
			query: `preview-${previewId}-right`,
		})
		editPreviewContentProvider.set(this.leftUri, content.leftContent)
		// The right side starts as the original; the animation sweeps the new content in.
		editPreviewContentProvider.set(this.rightUri, content.leftContent)

		await vscode.commands.executeCommand("vscode.diff", this.leftUri, this.rightUri, content.title, {
			preview: false,
		})

		// Fire-and-forget: the approval ask should render while the animation plays,
		// matching the legacy behavior of streaming alongside the Approve/Reject row.
		this.animation = this.animate(content).catch((error) => {
			Logger.warn(`[VscodeEditPreview] Preview animation failed: ${error}`)
			if (this.rightUri) {
				editPreviewContentProvider.set(this.rightUri, content.rightContent)
			}
		})
	}

	private async animate(content: EditPreviewContent): Promise<void> {
		const rightUri = this.rightUri
		if (!rightUri) {
			return
		}
		const totalLines = content.rightContent.split("\n").length
		const { frames, firstChangedLine } = buildEditPreviewAnimation(content.leftContent, content.rightContent)
		const editor = await this.findRightEditor(rightUri)
		if (!editor || totalLines > MAX_ANIMATED_LINES || frames.length <= 1) {
			editPreviewContentProvider.set(rightUri, content.rightContent)
			editor?.revealRange(new vscode.Range(firstChangedLine, 0, firstChangedLine, 0), vscode.TextEditorRevealType.InCenter)
			return
		}

		// Legacy sweep: park at the top of the file — whole doc under the faded overlay,
		// cursor highlight on line 0 — and hold there before the sweep starts, so the
		// animation clearly begins from the top. Then the frame pacing zips through
		// unchanged spans and slows through changes.
		const fadedOverlay = new DecorationController("fadedOverlay", editor)
		const activeLine = new DecorationController("activeLine", editor)
		editor.revealRange(new vscode.Range(0, 0, 0, 0), vscode.TextEditorRevealType.AtTop)
		fadedOverlay.addLines(0, editor.document.lineCount)
		activeLine.setActiveLine(0)
		await new Promise((resolve) => setTimeout(resolve, ANIMATION_START_BEAT_MS))

		try {
			for (const frame of frames) {
				if (this.animationCancelled) {
					return
				}
				editPreviewContentProvider.set(rightUri, frame.content)
				activeLine.setActiveLine(frame.activeLine)
				fadedOverlay.updateOverlayAfterLine(frame.activeLine, frame.content.split("\n").length)
				// Zips chase the cursor so fast spans read as continuous scroll; typing
				// only scrolls when the cursor would leave view, avoiding judder.
				editor.revealRange(
					new vscode.Range(frame.activeLine, 0, frame.activeLine, 0),
					frame.zip ? vscode.TextEditorRevealType.InCenter : vscode.TextEditorRevealType.InCenterIfOutsideViewport,
				)
				await new Promise((resolve) => setTimeout(resolve, frame.delayMs))
			}
		} finally {
			activeLine.clear()
			fadedOverlay.clear()
			if (!this.animationCancelled) {
				// Settle on the first change for review after the sweep reaches the bottom.
				await new Promise((resolve) => setTimeout(resolve, ANIMATION_END_BEAT_MS))
				editor.revealRange(
					new vscode.Range(firstChangedLine, 0, firstChangedLine, 0),
					vscode.TextEditorRevealType.InCenter,
				)
			}
		}
	}

	/** The diff editor may not appear in visibleTextEditors immediately after vscode.diff resolves. */
	private async findRightEditor(rightUri: vscode.Uri): Promise<vscode.TextEditor | undefined> {
		for (let attempt = 0; attempt < 10; attempt++) {
			const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === rightUri.toString())
			if (editor) {
				return editor
			}
			if (this.animationCancelled) {
				return undefined
			}
			await new Promise((resolve) => setTimeout(resolve, 50))
		}
		return undefined
	}

	override async close(): Promise<void> {
		this.animationCancelled = true
		await this.animation?.catch(() => {})
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
		} finally {
			editPreviewContentProvider.delete(leftUri)
			editPreviewContentProvider.delete(rightUri)
		}
	}
}
