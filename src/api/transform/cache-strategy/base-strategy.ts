import { Anthropic } from "@anthropic-ai/sdk"
import { ContentBlock, SystemContentBlock, Message, ConversationRole } from "@aws-sdk/client-bedrock-runtime"
import { CacheStrategyConfig, CacheResult, CachePointPlacement } from "./types"

export abstract class CacheStrategy {
	/**
	 * Determine optimal cache point placements and return the formatted result
	 */
	public abstract determineOptimalCachePoints(): CacheResult

	protected config: CacheStrategyConfig
	protected systemTokenCount: number = 0

	constructor(config: CacheStrategyConfig) {
		this.config = config
		this.initializeMessageGroups()
		this.calculateSystemTokens()
	}

	/**
	 * Initialize message groups from the input messages
	 */
	protected initializeMessageGroups(): void {
		if (!this.config.messages.length) return
	}

	/**
	 * Calculate token count for system prompt using a more accurate approach
	 */
	protected calculateSystemTokens(): void {
		if (this.config.systemPrompt) {
			const text = this.config.systemPrompt

			// Use a more accurate token estimation than simple character count
			// Count words and add overhead for punctuation and special tokens
			const words = text.split(/\s+/).filter((word) => word.length > 0)
			// Average English word is ~1.3 tokens
			let tokenCount = words.length * 1.3
			// Add overhead for punctuation and special characters
			tokenCount += (text.match(/[.,!?;:()[\]{}""''`]/g) || []).length * 0.3
			// Add overhead for newlines
			tokenCount += (text.match(/\n/g) || []).length * 0.5
			// Add a small overhead for system prompt structure
			tokenCount += 5

			this.systemTokenCount = Math.ceil(tokenCount)
		}
	}

	/**
	 * Create a cache point content block
	 */
	protected createCachePoint(): ContentBlock {
		return { cachePoint: { type: "default" } } as unknown as ContentBlock
	}

	/**
	 * Convert messages to content blocks
	 */
	protected messagesToContentBlocks(messages: Anthropic.Messages.MessageParam[]): Message[] {
		return messages.map((message) => {
			const role: ConversationRole = message.role === "assistant" ? "assistant" : "user"

			const content: ContentBlock[] = Array.isArray(message.content)
				? message.content.map((block) => {
						if (typeof block === "string") {
							return { text: block } as unknown as ContentBlock
						}
						if ("text" in block) {
							return { text: block.text } as unknown as ContentBlock
						}
						// Handle other content types if needed
						return { text: "[Unsupported Content]" } as unknown as ContentBlock
					})
				: [{ text: message.content } as unknown as ContentBlock]

			return {
				role,
				content,
			}
		})
	}

	/**
	 * Check if a token count meets the minimum threshold for caching
	 */
	protected meetsMinTokenThreshold(tokenCount: number): boolean {
		const minTokens = this.config.modelInfo.minTokensPerCachePoint
		if (!minTokens) {
			return false
		}
		return tokenCount >= minTokens
	}

	/**
	 * Estimate token count for a message using a more accurate approach
	 * This implementation is based on the BaseProvider's countTokens method
	 * but adapted to work without requiring an instance of BaseProvider
	 */
	protected estimateTokenCount(message: Anthropic.Messages.MessageParam): number {
		// Use a more sophisticated token counting approach
		if (!message.content) return 0

		let totalTokens = 0

		if (Array.isArray(message.content)) {
			for (const block of message.content) {
				if (block.type === "text") {
					// Use a more accurate token estimation than simple character count
					// This is still an approximation but better than character/4
					const text = block.text || ""
					if (text.length > 0) {
						// Count words and add overhead for punctuation and special tokens
						const words = text.split(/\s+/).filter((word) => word.length > 0)
						// Average English word is ~1.3 tokens
						totalTokens += words.length * 1.3
						// Add overhead for punctuation and special characters
						totalTokens += (text.match(/[.,!?;:()[\]{}""''`]/g) || []).length * 0.3
						// Add overhead for newlines
						totalTokens += (text.match(/\n/g) || []).length * 0.5
					}
				} else if (block.type === "image") {
					// For images, use a conservative estimate
					totalTokens += 300
				}
			}
		} else if (typeof message.content === "string") {
			const text = message.content
			// Count words and add overhead for punctuation and special tokens
			const words = text.split(/\s+/).filter((word) => word.length > 0)
			// Average English word is ~1.3 tokens
			totalTokens += words.length * 1.3
			// Add overhead for punctuation and special characters
			totalTokens += (text.match(/[.,!?;:()[\]{}""''`]/g) || []).length * 0.3
			// Add overhead for newlines
			totalTokens += (text.match(/\n/g) || []).length * 0.5
		}

		// Add a small overhead for message structure
		totalTokens += 10

		return Math.ceil(totalTokens)
	}

	/**
	 * Apply cache points to content blocks based on placements
	 */
	protected applyCachePoints(messages: Message[], placements: CachePointPlacement[]): Message[] {
		const result: Message[] = []
		for (let i = 0; i < messages.length; i++) {
			const placement = placements.find((p) => p.index === i)

			if (placement) {
				messages[i].content?.push(this.createCachePoint())
			}
			result.push(messages[i])
		}

		return result
	}

	/**
	 * Format the final result with cache points applied
	 */
	protected formatResult(systemBlocks: SystemContentBlock[] = [], messages: Message[]): CacheResult {
		const result = {
			system: systemBlocks,
			messages,
		}
		return result
	}
}
