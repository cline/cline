import { SystemContentBlock } from "@aws-sdk/client-bedrock-runtime"
import { CacheStrategy } from "./base-strategy"
import { CacheResult, CachePointPlacement } from "./types"
import { logger } from "../../../utils/logging"

/**
 * Strategy for handling multiple cache points.
 * Creates cache points after messages as soon as uncached tokens exceed minimumTokenCount.
 */
export class MultiPointStrategy extends CacheStrategy {
	/**
	 * Determine optimal cache point placements and return the formatted result
	 */
	public determineOptimalCachePoints(): CacheResult {
		// If prompt caching is disabled or no messages, return without cache points
		if (!this.config.usePromptCache || this.config.messages.length === 0) {
			return this.formatWithoutCachePoints()
		}

		const supportsSystemCache = this.config.modelInfo.cachableFields.includes("system")
		const supportsMessageCache = this.config.modelInfo.cachableFields.includes("messages")
		const minTokensPerPoint = this.config.modelInfo.minTokensPerCachePoint
		let remainingCachePoints: number = this.config.modelInfo.maxCachePoints

		// First, determine if we'll use a system cache point
		const useSystemCache =
			supportsSystemCache && this.config.systemPrompt && this.meetsMinTokenThreshold(this.systemTokenCount)

		// Handle system blocks
		let systemBlocks: SystemContentBlock[] = []
		if (this.config.systemPrompt) {
			systemBlocks = [{ text: this.config.systemPrompt } as unknown as SystemContentBlock]
			if (useSystemCache) {
				systemBlocks.push(this.createCachePoint() as unknown as SystemContentBlock)
				remainingCachePoints--
			}
		}

		// If message caching isn't supported, return with just system caching
		if (!supportsMessageCache) {
			return this.formatResult(systemBlocks, this.messagesToContentBlocks(this.config.messages))
		}

		const placements = this.determineMessageCachePoints(minTokensPerPoint, remainingCachePoints)
		const messages = this.messagesToContentBlocks(this.config.messages)
		let cacheResult = this.formatResult(systemBlocks, this.applyCachePoints(messages, placements))

		// Store the placements for future use (to maintain consistency across consecutive messages)
		// This needs to be handled by the caller by passing these placements back in the next call
		cacheResult.messageCachePointPlacements = placements

		return cacheResult
	}

	/**
	 * Determine optimal cache point placements for messages
	 * This method handles both new conversations and growing conversations
	 *
	 * @param minTokensPerPoint Minimum tokens required per cache point
	 * @param remainingCachePoints Number of cache points available
	 * @returns Array of cache point placements
	 */
	private determineMessageCachePoints(
		minTokensPerPoint: number,
		remainingCachePoints: number,
	): CachePointPlacement[] {
		if (this.config.messages.length <= 1) {
			return []
		}

		const placements: CachePointPlacement[] = []
		const totalMessages = this.config.messages.length
		const previousPlacements = this.config.previousCachePointPlacements || []

		// Special case: If previousPlacements is empty, place initial cache points
		if (previousPlacements.length === 0) {
			let currentIndex = 0

			while (currentIndex < totalMessages && remainingCachePoints > 0) {
				const newPlacement = this.findOptimalPlacementForRange(
					currentIndex,
					totalMessages - 1,
					minTokensPerPoint,
				)

				if (newPlacement) {
					placements.push(newPlacement)
					currentIndex = newPlacement.index + 1
					remainingCachePoints--
				} else {
					break
				}
			}

			return placements
		}

		// Calculate tokens in new messages (added since last cache point placement)
		const lastPreviousIndex = previousPlacements[previousPlacements.length - 1].index
		const newMessagesTokens = this.config.messages
			.slice(lastPreviousIndex + 1)
			.reduce((acc, curr) => acc + this.estimateTokenCount(curr), 0)

		// If new messages have enough tokens for a cache point, we need to decide
		// whether to keep all previous cache points or combine some
		if (newMessagesTokens >= minTokensPerPoint) {
			// If we have enough cache points for all previous placements plus a new one, keep them all
			if (remainingCachePoints > previousPlacements.length) {
				// Keep all previous placements
				for (const placement of previousPlacements) {
					if (placement.index < totalMessages) {
						placements.push(placement)
					}
				}

				// Add a new placement for the new messages
				const newPlacement = this.findOptimalPlacementForRange(
					lastPreviousIndex + 1,
					totalMessages - 1,
					minTokensPerPoint,
				)

				if (newPlacement) {
					placements.push(newPlacement)
				}
			} else {
				// We need to decide which previous cache points to keep and which to combine
				// Strategy: Compare the token count of new messages with the smallest combined token gap

				// First, analyze the token distribution between previous cache points
				const tokensBetweenPlacements: number[] = []
				let startIdx = 0

				for (const placement of previousPlacements) {
					const tokens = this.config.messages
						.slice(startIdx, placement.index + 1)
						.reduce((acc, curr) => acc + this.estimateTokenCount(curr), 0)

					tokensBetweenPlacements.push(tokens)
					startIdx = placement.index + 1
				}

				// Find the two consecutive placements with the smallest token gap
				let smallestGapIndex = 0
				let smallestGap = Number.MAX_VALUE

				for (let i = 0; i < tokensBetweenPlacements.length - 1; i++) {
					const gap = tokensBetweenPlacements[i] + tokensBetweenPlacements[i + 1]
					if (gap < smallestGap) {
						smallestGap = gap
						smallestGapIndex = i
					}
				}

				// Only combine cache points if it's beneficial
				// Compare the token count of new messages with the smallest combined token gap
				// Apply a required percentage increase to ensure reallocation is worth it
				const requiredPercentageIncrease = 1.2 // 20% increase required
				const requiredTokenThreshold = smallestGap * requiredPercentageIncrease

				if (newMessagesTokens >= requiredTokenThreshold) {
					// It's beneficial to combine cache points since new messages have significantly more tokens
					logger.info("Combining cache points is beneficial", {
						ctx: "cache-strategy",
						newMessagesTokens,
						smallestGap,
						requiredTokenThreshold,
						action: "combining_cache_points",
					})

					// Combine the two placements with the smallest gap
					for (let i = 0; i < previousPlacements.length; i++) {
						if (i !== smallestGapIndex && i !== smallestGapIndex + 1) {
							// Keep this placement
							if (previousPlacements[i].index < totalMessages) {
								placements.push(previousPlacements[i])
							}
						} else if (i === smallestGapIndex) {
							// Replace with a combined placement
							const combinedEndIndex = previousPlacements[i + 1].index

							// Find the optimal placement within this combined range
							const startOfRange = i === 0 ? 0 : previousPlacements[i - 1].index + 1
							const combinedPlacement = this.findOptimalPlacementForRange(
								startOfRange,
								combinedEndIndex,
								minTokensPerPoint,
							)

							if (combinedPlacement) {
								placements.push(combinedPlacement)
							}

							// Skip the next placement as we've combined it
							i++
						}
					}

					// If we freed up a cache point, use it for the new messages
					if (placements.length < remainingCachePoints) {
						const newPlacement = this.findOptimalPlacementForRange(
							lastPreviousIndex + 1,
							totalMessages - 1,
							minTokensPerPoint,
						)

						if (newPlacement) {
							placements.push(newPlacement)
						}
					}
				} else {
					// It's not beneficial to combine cache points
					// Keep all previous placements and don't add a new one for the new messages
					logger.info("Combining cache points is not beneficial", {
						ctx: "cache-strategy",
						newMessagesTokens,
						smallestGap,
						action: "keeping_existing_cache_points",
					})

					// Keep all previous placements that are still valid
					for (const placement of previousPlacements) {
						if (placement.index < totalMessages) {
							placements.push(placement)
						}
					}
				}
			}

			return placements
		} else {
			// New messages don't have enough tokens for a cache point
			// Keep all previous placements that are still valid
			for (const placement of previousPlacements) {
				if (placement.index < totalMessages) {
					placements.push(placement)
				}
			}

			return placements
		}
	}

	/**
	 * Find the optimal placement for a cache point within a specified range of messages
	 * Simply finds the last user message in the range
	 */
	private findOptimalPlacementForRange(
		startIndex: number,
		endIndex: number,
		minTokensPerPoint: number,
	): CachePointPlacement | null {
		if (startIndex >= endIndex) {
			return null
		}

		// Find the last user message in the range
		let lastUserMessageIndex = -1
		for (let i = endIndex; i >= startIndex; i--) {
			if (this.config.messages[i].role === "user") {
				lastUserMessageIndex = i
				break
			}
		}

		if (lastUserMessageIndex >= 0) {
			// Calculate the total tokens covered from the previous cache point (or start of conversation)
			// to this cache point. This ensures tokensCovered represents the full span of tokens
			// that will be cached by this cache point.
			let totalTokensCovered = 0

			// Find the previous cache point index
			const previousPlacements = this.config.previousCachePointPlacements || []
			let previousCachePointIndex = -1

			for (const placement of previousPlacements) {
				if (placement.index < startIndex && placement.index > previousCachePointIndex) {
					previousCachePointIndex = placement.index
				}
			}

			// Calculate tokens from previous cache point (or start) to this cache point
			const tokenStartIndex = previousCachePointIndex + 1
			totalTokensCovered = this.config.messages
				.slice(tokenStartIndex, lastUserMessageIndex + 1)
				.reduce((acc, curr) => acc + this.estimateTokenCount(curr), 0)

			// Guard clause: ensure we have enough tokens to justify a cache point
			if (totalTokensCovered < minTokensPerPoint) {
				return null
			}
			return {
				index: lastUserMessageIndex,
				type: "message",
				tokensCovered: totalTokensCovered,
			}
		}

		return null
	}

	/**
	 * Format result without cache points
	 *
	 * @returns Cache result without cache points
	 */
	private formatWithoutCachePoints(): CacheResult {
		const systemBlocks: SystemContentBlock[] = this.config.systemPrompt
			? [{ text: this.config.systemPrompt } as unknown as SystemContentBlock]
			: []

		return this.formatResult(systemBlocks, this.messagesToContentBlocks(this.config.messages))
	}
}
