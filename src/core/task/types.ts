/**
 * Type definitions for Task-related metadata
 */

/**
 * GPT-5 specific metadata stored with assistant messages
 * for maintaining conversation continuity across requests
 */
export interface Gpt5Metadata {
	/**
	 * The response ID from the previous GPT-5 API response
	 * Used to maintain conversation continuity in subsequent requests
	 */
	previous_response_id?: string

	/**
	 * The system instructions/prompt used for this response
	 * Stored to track what instructions were active when the response was generated
	 */
	instructions?: string

	/**
	 * The reasoning summary from GPT-5's reasoning process
	 * Contains the model's internal reasoning if reasoning mode was enabled
	 */
	reasoning_summary?: string
}

/**
 * Extended ClineMessage type with GPT-5 metadata
 */
export interface ClineMessageWithMetadata {
	metadata?: {
		gpt5?: Gpt5Metadata
		[key: string]: any
	}
}
