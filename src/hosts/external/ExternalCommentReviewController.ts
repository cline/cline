import { CommentReviewController, type OnReplyCallback, type ReviewComment } from "@/integrations/editor/CommentReviewController"

/**
 * External (non-VS Code) implementation of CommentReviewController.
 *
 * This is a no-op implementation for platforms that don't support
 * inline code comments (e.g., JetBrains, CLI).
 */
export class ExternalCommentReviewController extends CommentReviewController {
	setOnReplyCallback(_callback: OnReplyCallback): void {
		// No-op
	}

	async ensureCommentsViewDisabled(): Promise<void> {
		// No-op
	}

	addReviewComment(_comment: ReviewComment): void {
		// No-op
	}

	startStreamingComment(
		_filePath: string,
		_startLine: number,
		_endLine: number,
		_relativePath?: string,
		_fileContent?: string,
		_revealComment?: boolean,
	): void {
		// No-op
	}

	appendToStreamingComment(_chunk: string): void {
		// No-op
	}

	endStreamingComment(): void {
		// No-op
	}

	addReviewComments(_comments: ReviewComment[]): void {
		// No-op
	}

	clearAllComments(): void {
		// No-op
	}

	clearCommentsForFile(_filePath: string): void {
		// No-op
	}

	getThreadCount(): number {
		return 0
	}

	async closeDiffViews(): Promise<void> {
		// No-op
	}

	dispose(): void {
		// No-op
	}
}
