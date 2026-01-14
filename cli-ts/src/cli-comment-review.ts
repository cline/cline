/**
 * CLI-specific CommentReviewController implementation
 * Handles code review comments in CLI mode
 */

import { CommentReviewController } from "@/integrations/editor/CommentReviewController"
import { print, style } from "./display"

export class CliCommentReviewController extends CommentReviewController {
	private comments: Map<string, string[]> = new Map()

	override async addComment(filePath: string, line: number, comment: string): Promise<void> {
		const key = `${filePath}:${line}`
		const existing = this.comments.get(key) || []
		existing.push(comment)
		this.comments.set(key, existing)

		print(style.info(`💬 Comment on ${filePath}:${line}`))
		print(style.dim(`   ${comment}`))
	}

	override async clearComments(filePath?: string): Promise<void> {
		if (filePath) {
			// Clear comments for specific file
			for (const key of this.comments.keys()) {
				if (key.startsWith(filePath)) {
					this.comments.delete(key)
				}
			}
		} else {
			this.comments.clear()
		}
	}

	override dispose(): void {
		this.comments.clear()
	}
}
