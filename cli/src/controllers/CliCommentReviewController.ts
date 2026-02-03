/**
 * CLI-specific CommentReviewController implementation
 * Handles code review comments in CLI mode
 */

import { CommentReviewController, type OnReplyCallback, type ReviewComment } from "@/integrations/editor/CommentReviewController"
import { print, style } from "../utils/display"

export class CliCommentReviewController extends CommentReviewController {
	private comments: Map<string, string[]> = new Map()
	private streamingComment: { filePath: string; startLine: number; endLine: number; content: string } | null = null

	setOnReplyCallback(_callback: OnReplyCallback): void {
		// No-op - CLI doesn't support interactive replies
	}

	async ensureCommentsViewDisabled(): Promise<void> {
		// No-op - no comments view in CLI
	}

	addReviewComment(comment: ReviewComment): void {
		const key = `${comment.filePath}:${comment.startLine}:${comment.endLine}`
		const existing = this.comments.get(key) || []
		existing.push(comment.comment)
		this.comments.set(key, existing)

		print(style.info(`Comment on ${comment.filePath}:${comment.startLine + 1}`))
		print(style.dim(`   ${comment.comment}`))
	}

	startStreamingComment(
		filePath: string,
		startLine: number,
		endLine: number,
		_relativePath?: string,
		_fileContent?: string,
		_revealComment?: boolean,
	): void {
		this.streamingComment = { filePath, startLine, endLine, content: "" }
		print(style.info(`Comment on ${filePath}:${startLine + 1}`))
	}

	appendToStreamingComment(chunk: string): void {
		if (this.streamingComment) {
			this.streamingComment.content += chunk
			process.stdout.write(chunk)
		}
	}

	endStreamingComment(): void {
		if (this.streamingComment) {
			const key = `${this.streamingComment.filePath}:${this.streamingComment.startLine}:${this.streamingComment.endLine}`
			const existing = this.comments.get(key) || []
			existing.push(this.streamingComment.content)
			this.comments.set(key, existing)
			print("") // newline after streaming
			this.streamingComment = null
		}
	}

	addReviewComments(comments: ReviewComment[]): void {
		for (const comment of comments) {
			this.addReviewComment(comment)
		}
	}

	clearAllComments(): void {
		this.comments.clear()
	}

	clearCommentsForFile(filePath: string): void {
		for (const key of this.comments.keys()) {
			if (key.startsWith(filePath)) {
				this.comments.delete(key)
			}
		}
	}

	getThreadCount(): number {
		return this.comments.size
	}

	async closeDiffViews(): Promise<void> {
		// No-op - no diff views in CLI
	}

	dispose(): void {
		this.comments.clear()
		this.streamingComment = null
	}
}
