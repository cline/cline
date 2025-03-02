import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from ".."
import { ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { Tiktoken } from "js-tiktoken/lite"
import o200kBase from "js-tiktoken/ranks/o200k_base"

// Reuse the fudge factor used in the original code
const TOKEN_FUDGE_FACTOR = 1.5

/**
 * Base class for API providers that implements common functionality
 */
export abstract class BaseProvider implements ApiHandler {
	// Cache the Tiktoken encoder instance since it's stateless
	private encoder: Tiktoken | null = null
	abstract createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream
	abstract getModel(): { id: string; info: ModelInfo }

	/**
	 * Default token counting implementation using tiktoken
	 * Providers can override this to use their native token counting endpoints
	 *
	 * Uses a cached Tiktoken encoder instance for performance since it's stateless.
	 * The encoder is created lazily on first use and reused for subsequent calls.
	 *
	 * @param content The content to count tokens for
	 * @returns A promise resolving to the token count
	 */
	async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		if (!content || content.length === 0) return 0

		let totalTokens = 0

		// Lazily create and cache the encoder if it doesn't exist
		if (!this.encoder) {
			this.encoder = new Tiktoken(o200kBase)
		}

		// Process each content block using the cached encoder
		for (const block of content) {
			if (block.type === "text") {
				// Use tiktoken for text token counting
				const text = block.text || ""
				if (text.length > 0) {
					const tokens = this.encoder.encode(text)
					totalTokens += tokens.length
				}
			} else if (block.type === "image") {
				// For images, calculate based on data size
				const imageSource = block.source
				if (imageSource && typeof imageSource === "object" && "data" in imageSource) {
					const base64Data = imageSource.data as string
					totalTokens += Math.ceil(Math.sqrt(base64Data.length))
				} else {
					totalTokens += 300 // Conservative estimate for unknown images
				}
			}
		}

		// Add a fudge factor to account for the fact that tiktoken is not always accurate
		return Math.ceil(totalTokens * TOKEN_FUDGE_FACTOR)
	}
}
