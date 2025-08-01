import { get_encoding, Tiktoken } from "tiktoken"

/**
 * Shared token counter utility using tiktoken's cl100k_base encoding
 * This provides a universal proxy token counter that works reasonably well for most models
 */
class TokenCounter {
	private encoding: Tiktoken | null = null
	private initializationPromise: Promise<void> | null = null

	/**
	 * Initialize the tiktoken encoding (lazy loading)
	 */
	private async initialize(): Promise<void> {
		if (this.encoding) return

		if (!this.initializationPromise) {
			this.initializationPromise = this.doInitialize()
		}
		return this.initializationPromise
	}

	private async doInitialize(): Promise<void> {
		try {
			this.encoding = get_encoding("cl100k_base")
		} catch (error) {
			console.warn("Failed to initialize tiktoken encoding:", error)
			this.encoding = null
		}
	}

	/**
	 * Estimate token count for a text string using tiktoken
	 * Falls back to character-based estimation if tiktoken fails
	 */
	async estimateTokens(text: string): Promise<number> {
		if (!text) return 0

		try {
			await this.initialize()
			if (this.encoding) {
				return this.encoding.encode(text).length
			}
		} catch (error) {
			console.warn("Tiktoken encoding failed, falling back to character estimation:", error)
		}

		// Fallback to character-based estimation (roughly 4 chars per token)
		return Math.ceil(text.length / 4)
	}

	/**
	 * Estimate token count synchronously using character-based approximation
	 * Use this when you need immediate results without async overhead
	 */
	estimateTokensSync(text: string): number {
		if (!text) return 0

		// Try tiktoken if already initialized
		if (this.encoding) {
			try {
				return this.encoding.encode(text).length
			} catch (error) {
				console.warn("Tiktoken encoding failed, falling back to character estimation:", error)
			}
		}

		// Fallback to character-based estimation (roughly 4 chars per token)
		return Math.ceil(text.length / 4)
	}

	/**
	 * Extract text content from various message formats and estimate tokens
	 */
	async estimateTokensFromMessages(messages: any[]): Promise<number> {
		let totalText = ""

		for (const message of messages) {
			if (typeof message === "string") {
				totalText += message + "\n"
			} else if (message && typeof message === "object") {
				// Handle various message formats
				if (message.content) {
					if (typeof message.content === "string") {
						totalText += message.content + "\n"
					} else if (Array.isArray(message.content)) {
						// Handle content blocks (like Anthropic format)
						for (const block of message.content) {
							if (block && typeof block === "object" && block.type === "text" && block.text) {
								totalText += block.text + "\n"
							}
						}
					}
				} else if (message.text) {
					totalText += message.text + "\n"
				}
			}
		}

		return this.estimateTokens(totalText)
	}

	/**
	 * Clean up resources
	 */
	dispose(): void {
		if (this.encoding) {
			try {
				this.encoding.free()
			} catch (error) {
				// Ignore cleanup errors
			}
			this.encoding = null
		}
		this.initializationPromise = null
	}
}

// Export a singleton instance
export const tokenCounter = new TokenCounter()

// Export convenience functions
export const estimateTokens = (text: string): Promise<number> => tokenCounter.estimateTokens(text)
export const estimateTokensSync = (text: string): number => tokenCounter.estimateTokensSync(text)
export const estimateTokensFromMessages = (messages: any[]): Promise<number> => tokenCounter.estimateTokensFromMessages(messages)
