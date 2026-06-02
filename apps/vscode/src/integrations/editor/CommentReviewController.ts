/**
 * Represents a review comment from the AI
 */
export interface ReviewComment {
	/** Absolute path to the file */
	filePath: string
	/** 0-indexed start line of the code this comment applies to */
	startLine: number
	/** 0-indexed end line of the code this comment applies to */
	endLine: number
	/** The comment text (supports markdown) */
	comment: string
	/** Optional label for the comment type */
	label?: string
	/** Relative path for virtual URI (e.g., "src/file.ts") */
	relativePath?: string
	/** File content for virtual URI (encoded in query string) */
	fileContent?: string
}

/**
 * Callback for when user replies to a comment thread.
 * The onChunk callback is called with each text chunk as it streams in.
 */
export type OnReplyCallback = (
	filePath: string,
	startLine: number,
	endLine: number,
	replyText: string,
	existingComments: string[],
	onChunk: (chunk: string) => void,
) => Promise<void>

/**
 * Abstract base class for managing AI code review comments.
 *
 * This controller:
 * - Creates inline comment threads on files at specific line ranges
 * - Displays AI-generated review comments with markdown support
 * - Handles user replies and dispatches them to the AI
 * - Manages the lifecycle of all comment threads
 *
 * Platform-specific implementations handle the actual UI rendering.
 */
export abstract class CommentReviewController {
	/**
	 * Set the callback for handling user replies
	 */
	abstract setOnReplyCallback(callback: OnReplyCallback): void

	/**
	 * Ensure the comments view won't auto-open when comments are added
	 */
	abstract ensureCommentsViewDisabled(): Promise<void>

	/**
	 * Add a review comment to a file
	 */
	abstract addReviewComment(comment: ReviewComment): void

	/**
	 * Start a streaming review comment - creates the thread immediately with placeholder text
	 * @param revealComment - If true, opens the document and scrolls to show the comment
	 */
	abstract startStreamingComment(
		filePath: string,
		startLine: number,
		endLine: number,
		relativePath?: string,
		fileContent?: string,
		revealComment?: boolean,
	): void

	/**
	 * Append text to the currently streaming comment
	 */
	abstract appendToStreamingComment(chunk: string): void

	/**
	 * End the current streaming comment
	 */
	abstract endStreamingComment(): void

	/**
	 * Add multiple review comments at once
	 */
	abstract addReviewComments(comments: ReviewComment[]): void

	/**
	 * Clear all review comments
	 */
	abstract clearAllComments(): void

	/**
	 * Clear comments for a specific file
	 */
	abstract clearCommentsForFile(filePath: string): void

	/**
	 * Get the number of active comment threads
	 */
	abstract getThreadCount(): number

	/**
	 * Close all diff views associated with comments
	 */
	abstract closeDiffViews(): Promise<void>

	/**
	 * Dispose of all resources
	 */
	abstract dispose(): void
}
