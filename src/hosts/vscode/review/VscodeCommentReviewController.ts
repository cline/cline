import * as vscode from "vscode"
import { sendAddToInputEvent } from "@/core/controller/ui/subscribeToAddToInput"
import { CommentReviewController, type OnReplyCallback, type ReviewComment } from "@/integrations/editor/CommentReviewController"
import { DIFF_VIEW_URI_SCHEME } from "../VscodeDiffViewProvider"

/**
 * Cline's GitHub avatar URL
 */
const CLINE_AVATAR_URL = "https://avatars.githubusercontent.com/u/184127137"

/**
 * VS Code implementation of CommentReviewController.
 *
 * Uses VS Code's Comment API to create inline comment threads on files.
 * Comments appear in VS Code's Comments Panel and inline in editors.
 */
export class VscodeCommentReviewController extends CommentReviewController implements vscode.Disposable {
	private commentController: vscode.CommentController
	private threads: Map<string, vscode.CommentThread> = new Map()
	/** Maps thread to its absolute file path (needed because virtual URIs don't contain the full path) */
	private threadFilePaths: Map<vscode.CommentThread, string> = new Map()
	private onReplyCallback?: OnReplyCallback
	private disposables: vscode.Disposable[] = []

	/** The currently streaming comment thread */
	private streamingThread: vscode.CommentThread | null = null
	private streamingContent: string = ""

	constructor() {
		super()
		// Create the comment controller
		this.commentController = vscode.comments.createCommentController("cline-ai-review", "Cline AI Review")

		// Configure options for the reply input
		this.commentController.options = {
			placeHolder: "Ask a question about this code...",
			prompt: "Reply to Cline",
		}

		// Configure the commenting range provider (optional - allows commenting on any line)
		this.commentController.commentingRangeProvider = {
			provideCommentingRanges: (document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.Range[] => {
				// Allow commenting on any line in the document
				const lineCount = document.lineCount
				return [new vscode.Range(0, 0, lineCount - 1, 0)]
			},
		}

		// Register reply command - this is called when user clicks the Reply button
		this.disposables.push(
			vscode.commands.registerCommand("cline.reviewComment.reply", async (reply: vscode.CommentReply) => {
				await this.handleReply(reply)
			}),
		)

		// Register add to chat command - sends the conversation to Cline's main chat
		this.disposables.push(
			vscode.commands.registerCommand("cline.reviewComment.addToChat", async (thread: vscode.CommentThread) => {
				await this.handleAddToChat(thread)
			}),
		)
	}

	/**
	 * Set the callback for handling user replies
	 */
	setOnReplyCallback(callback: OnReplyCallback): void {
		this.onReplyCallback = callback
	}

	/**
	 * Ensure the comments.openView setting is set to "never" to prevent
	 * the Comments panel from auto-opening when comments are added.
	 */
	async ensureCommentsViewDisabled(): Promise<void> {
		const config = vscode.workspace.getConfiguration("comments")
		const currentValue = config.get<string>("openView")
		if (currentValue !== "never") {
			await config.update("openView", "never", vscode.ConfigurationTarget.Global)
		}
	}

	/**
	 * Add a review comment to a file
	 */
	addReviewComment(comment: ReviewComment): void {
		// Use virtual diff URI if relativePath and fileContent are provided
		// This allows comments to attach to the diff view's virtual documents
		let uri: vscode.Uri
		if (comment.relativePath && comment.fileContent !== undefined) {
			uri = vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${comment.relativePath}`).with({
				query: Buffer.from(comment.fileContent).toString("base64"),
			})
		} else {
			uri = vscode.Uri.file(comment.filePath)
		}
		const range = new vscode.Range(
			new vscode.Position(comment.startLine, 0),
			new vscode.Position(comment.endLine, Number.MAX_SAFE_INTEGER),
		)

		// Create the comment object
		const commentObj: vscode.Comment = {
			body: new vscode.MarkdownString(comment.comment),
			mode: vscode.CommentMode.Preview,
			author: {
				name: "Cline",
				iconPath: vscode.Uri.parse(CLINE_AVATAR_URL),
			},
		}

		// Create the thread
		const thread = this.commentController.createCommentThread(uri, range, [commentObj])

		// Configure thread
		thread.canReply = true
		thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded

		// Store for later management
		const threadKey = this.getThreadKey(comment.filePath, comment.startLine, comment.endLine)
		this.threads.set(threadKey, thread)
		// Store absolute file path for reply handling (virtual URIs don't contain the full path)
		this.threadFilePaths.set(thread, comment.filePath)
	}

	/**
	 * Start a streaming review comment - creates the thread immediately with placeholder text
	 * @param revealComment - If true, opens the document and scrolls to show the comment (default: false)
	 */
	startStreamingComment(
		filePath: string,
		startLine: number,
		endLine: number,
		relativePath?: string,
		fileContent?: string,
		revealComment: boolean = false,
	): void {
		// Use virtual diff URI if relativePath and fileContent are provided
		let uri: vscode.Uri
		if (relativePath && fileContent !== undefined) {
			uri = vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${relativePath}`).with({
				query: Buffer.from(fileContent).toString("base64"),
			})
		} else {
			uri = vscode.Uri.file(filePath)
		}
		const range = new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine, Number.MAX_SAFE_INTEGER))

		// Create with placeholder
		const commentObj: vscode.Comment = {
			body: new vscode.MarkdownString("_Thinking..._"),
			mode: vscode.CommentMode.Preview,
			author: {
				name: "Cline",
				iconPath: vscode.Uri.parse(CLINE_AVATAR_URL),
			},
		}

		// Create the thread
		const thread = this.commentController.createCommentThread(uri, range, [commentObj])
		thread.canReply = true
		thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded

		// Store for streaming updates
		this.streamingThread = thread
		this.streamingContent = ""

		// Store for later management
		const threadKey = this.getThreadKey(filePath, startLine, endLine)
		this.threads.set(threadKey, thread)
		this.threadFilePaths.set(thread, filePath)

		// Open the virtual document and scroll to show the comment in center (only if requested)
		if (revealComment) {
			this.revealCommentInDocument(thread)
		}
	}

	/**
	 * Open the document containing the comment and scroll to show it in center.
	 * This is used during streaming to show each comment as it's added.
	 */
	private async revealCommentInDocument(thread: vscode.CommentThread): Promise<void> {
		try {
			// Open the document (works with virtual URIs)
			const doc = await vscode.workspace.openTextDocument(thread.uri)

			// Show the document and scroll to the comment
			// Use the start of the range so the comment appears in center (not the code block)
			const commentPosition = new vscode.Range(thread.range.start, thread.range.start)
			const editor = await vscode.window.showTextDocument(doc, {
				selection: commentPosition,
				preserveFocus: false,
				preview: true,
			})

			// Reveal with the start position in center so the comment bubble is visible
			editor.revealRange(commentPosition, vscode.TextEditorRevealType.InCenter)
		} catch (error) {
			// Ignore errors - this is not critical
			console.error("[VscodeCommentReviewController] Error revealing comment:", error)
		}
	}

	/**
	 * Append text to the currently streaming comment
	 */
	appendToStreamingComment(chunk: string): void {
		if (!this.streamingThread) {
			return
		}

		this.streamingContent += chunk

		// Update the comment body - reassigning comments triggers VS Code to refresh the UI
		const commentObj: vscode.Comment = {
			body: new vscode.MarkdownString(this.streamingContent || "_Thinking..._"),
			mode: vscode.CommentMode.Preview,
			author: {
				name: "Cline",
				iconPath: vscode.Uri.parse(CLINE_AVATAR_URL),
			},
		}
		// Create a new array to ensure VS Code detects the change
		this.streamingThread.comments = [...[commentObj]]
	}

	/**
	 * End the current streaming comment
	 */
	endStreamingComment(): void {
		if (!this.streamingThread) {
			return
		}

		// Finalize with trimmed content
		const finalContent = this.streamingContent.trim() || "_No comment generated_"
		const commentObj: vscode.Comment = {
			body: new vscode.MarkdownString(finalContent),
			mode: vscode.CommentMode.Preview,
			author: {
				name: "Cline",
				iconPath: vscode.Uri.parse(CLINE_AVATAR_URL),
			},
		}
		this.streamingThread.comments = [commentObj]

		// Clear streaming state
		this.streamingThread = null
		this.streamingContent = ""
	}

	/**
	 * Add multiple review comments at once
	 */
	addReviewComments(comments: ReviewComment[]): void {
		comments.forEach((comment) => this.addReviewComment(comment))
	}

	/**
	 * Clear all review comments
	 */
	clearAllComments(): void {
		for (const thread of this.threads.values()) {
			this.threadFilePaths.delete(thread)
			thread.dispose()
		}
		this.threads.clear()
	}

	/**
	 * Clear comments for a specific file
	 */
	clearCommentsForFile(filePath: string): void {
		const keysToRemove: string[] = []
		for (const [key, thread] of this.threads.entries()) {
			if (key.startsWith(filePath + ":")) {
				this.threadFilePaths.delete(thread)
				thread.dispose()
				keysToRemove.push(key)
			}
		}
		for (const key of keysToRemove) {
			this.threads.delete(key)
		}
	}

	/**
	 * Get the number of active comment threads
	 */
	getThreadCount(): number {
		return this.threads.size
	}

	/**
	 * Handle a reply from the user
	 */
	private async handleReply(reply: vscode.CommentReply): Promise<void> {
		const thread = reply.thread
		const replyText = reply.text

		// Add user's reply to the thread immediately
		const userComment: vscode.Comment = {
			body: new vscode.MarkdownString(replyText),
			mode: vscode.CommentMode.Preview,
			author: {
				name: "You",
			},
		}
		thread.comments = [...thread.comments, userComment]

		// If we have a callback, get AI response
		if (this.onReplyCallback) {
			// Use stored absolute path (virtual URIs don't contain the full path)
			const filePath = this.threadFilePaths.get(thread) || thread.uri.fsPath
			const startLine = thread.range.start.line
			const endLine = thread.range.end.line

			// Collect existing comments for context (exclude the user's reply we just added)
			const existingComments = thread.comments.slice(0, -1).map((c) => {
				const author = c.author.name
				const body = typeof c.body === "string" ? c.body : c.body.value
				return `${author}: ${body}`
			})

			// Add an empty streaming comment that will be updated as chunks arrive
			let streamingContent = ""
			const updateStreamingComment = (content: string) => {
				const streamingComment: vscode.Comment = {
					body: new vscode.MarkdownString(content || "_Thinking..._"),
					mode: vscode.CommentMode.Preview,
					author: {
						name: "Cline",
						iconPath: vscode.Uri.parse(CLINE_AVATAR_URL),
					},
				}
				thread.comments = [...thread.comments.slice(0, -1), streamingComment]
			}

			// Add initial thinking placeholder
			const thinkingComment: vscode.Comment = {
				body: new vscode.MarkdownString("_Thinking..._"),
				mode: vscode.CommentMode.Preview,
				author: {
					name: "Cline",
					iconPath: vscode.Uri.parse(CLINE_AVATAR_URL),
				},
			}
			thread.comments = [...thread.comments, thinkingComment]

			// Fire off the AI request with streaming callback
			this.onReplyCallback(filePath, startLine, endLine, replyText, existingComments, (chunk) => {
				// Append chunk and update the comment
				streamingContent += chunk
				updateStreamingComment(streamingContent)
			})
				.then(() => {
					// Ensure final content is displayed
					if (streamingContent) {
						updateStreamingComment(streamingContent)
					}
				})
				.catch((error) => {
					// Show error
					const errorComment: vscode.Comment = {
						body: new vscode.MarkdownString(
							`_Error getting response: ${error instanceof Error ? error.message : "Unknown error"}_`,
						),
						mode: vscode.CommentMode.Preview,
						author: {
							name: "Cline",
							iconPath: vscode.Uri.parse(CLINE_AVATAR_URL),
						},
					}
					thread.comments = [...thread.comments.slice(0, -1), errorComment]
				})
		}
	}

	/**
	 * Handle adding the thread conversation to Cline's main chat
	 */
	private async handleAddToChat(thread: vscode.CommentThread): Promise<void> {
		const filePath = this.threadFilePaths.get(thread) || thread.uri.fsPath
		const startLine = thread.range.start.line + 1 // Convert to 1-indexed for display
		const endLine = thread.range.end.line + 1

		// Collect all comments from the thread
		const conversation = thread.comments
			.map((c) => {
				const author = c.author.name === "You" ? "User" : c.author.name
				const body = typeof c.body === "string" ? c.body : c.body.value
				return `**${author}:** ${body}`
			})
			.join("\n\n")

		// Format the context message
		const contextMessage = `The following is a conversation from a code review comment on \`${filePath}\` (lines ${startLine}-${endLine}). The user would like to continue this discussion with you:

---

${conversation}

---

Please continue helping the user with their question about this code.`

		await sendAddToInputEvent(contextMessage)
	}

	private getThreadKey(filePath: string, startLine: number, endLine: number): string {
		return `${filePath}:${startLine}:${endLine}`
	}

	/**
	 * Close all tabs that use the cline-diff URI scheme (both diff views and regular text documents)
	 */
	async closeDiffViews(): Promise<void> {
		const tabs = vscode.window.tabGroups.all
			.flatMap((tg) => tg.tabs)
			.filter((tab) => {
				// Check for diff view tabs
				if (tab.input instanceof vscode.TabInputTextDiff && tab.input?.original?.scheme === DIFF_VIEW_URI_SCHEME) {
					return true
				}
				// Check for regular text document tabs with cline-diff scheme (opened during comment reveal)
				if (tab.input instanceof vscode.TabInputText && tab.input?.uri?.scheme === DIFF_VIEW_URI_SCHEME) {
					return true
				}
				return false
			})
		for (const tab of tabs) {
			try {
				await vscode.window.tabGroups.close(tab)
			} catch (error) {
				// Tab might already be closed
				console.warn("Failed to close diff tab:", error)
			}
		}
	}

	dispose(): void {
		this.clearAllComments()
		this.commentController.dispose()
		for (const disposable of this.disposables) {
			disposable.dispose()
		}
	}
}

// Singleton instance for the extension
let instance: VscodeCommentReviewController | undefined

/**
 * Get or create the VscodeCommentReviewController singleton
 */
export function getVscodeCommentReviewController(): VscodeCommentReviewController {
	if (!instance) {
		instance = new VscodeCommentReviewController()
	}
	return instance
}

/**
 * Dispose the VscodeCommentReviewController singleton
 */
export function disposeVscodeCommentReviewController(): void {
	if (instance) {
		instance.dispose()
		instance = undefined
	}
}
