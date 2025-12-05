import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "@core/api"
import { formatResponse } from "@core/prompts/responses"
import { GlobalFileNames } from "@core/storage/disk"
import { ClineApiReqInfo, ClineMessage } from "@shared/ExtensionMessage"
import { fileExistsAtPath } from "@utils/fs"
import cloneDeep from "clone-deep"
import fs from "fs/promises"
import * as path from "path"
import { getContextWindowInfo } from "./context-window-utils"

enum EditType {
	UNDEFINED = 0,
	NO_FILE_READ = 1,
	READ_FILE_TOOL = 2,
	ALTER_FILE_TOOL = 3,
	FILE_MENTION = 4,
}

// array of string values allows us to cover all changes for message types currently supported
type MessageContent = string[]
type MessageMetadata = string[][]

// Type for a single context update
type ContextUpdate = [number, string, MessageContent, MessageMetadata] // [timestamp, updateType, update, metadata]

// Type for the serialized format of our nested maps
type SerializedContextHistory = Array<
	[
		number, // messageIndex
		[
			number, // EditType (message type)
			Array<
				[
					number, // blockIndex
					ContextUpdate[], // updates array (now with 4 elements including metadata)
				]
			>,
		],
	]
>

export class ContextManager {
	// mapping from the apiMessages outer index to the inner message index to a list of actual changes, ordered by timestamp
	// timestamp is required in order to support full checkpointing, where the changes we apply need to be able to be undone when
	// moving to an earlier conversation history checkpoint - this ordering intuitively allows for binary search on truncation
	// there is also a number stored for each (EditType) which defines which message type it is, for custom handling

	// format:  { outerIndex => [EditType, { innerIndex => [[timestamp, updateType, update], ...] }] }
	// example: { 1 => { [0, 0 => [[<timestamp>, "text", "[NOTE] Some previous conversation history with the user has been removed ..."], ...] }] }
	// the above example would be how we update the first assistant message to indicate we truncated text
	private contextHistoryUpdates: Map<number, [number, Map<number, ContextUpdate[]>]>

	constructor() {
		this.contextHistoryUpdates = new Map()
	}

	/**
	 * Extracts text from a content block, handling both regular text blocks and tool_result wrappers.
	 * For tool_result blocks, extracts text from content[0] (native tool calling format).
	 * @returns The text content, or null if no text could be extracted
	 */
	private getTextFromBlock(block: Anthropic.Messages.ContentBlockParam): string | null {
		if (block.type === "text") {
			return block.text
		}
		if (block.type === "tool_result" && Array.isArray(block.content)) {
			const inner = block.content[0]
			if (inner && "type" in inner && inner.type === "text") {
				return inner.text
			}
		}
		return null
	}

	/**
	 * Sets text in a content block, handling both regular text blocks and tool_result wrappers.
	 * For tool_result blocks, sets text in content[0] (native tool calling format).
	 * @returns true if text was set successfully, false otherwise
	 */
	private setTextInBlock(block: Anthropic.Messages.ContentBlockParam, text: string): boolean {
		if (block.type === "text") {
			block.text = text
			return true
		}
		if (block.type === "tool_result" && Array.isArray(block.content)) {
			const inner = block.content[0]
			if (inner && "type" in inner && inner.type === "text") {
				inner.text = text
				return true
			}
		}
		return false
	}

	/**
	 * public function for loading contextHistoryUpdates from disk, if it exists
	 */
	async initializeContextHistory(taskDirectory: string) {
		this.contextHistoryUpdates = await this.getSavedContextHistory(taskDirectory)
	}

	/**
	 * get the stored context history updates from disk
	 */
	private async getSavedContextHistory(taskDirectory: string): Promise<Map<number, [number, Map<number, ContextUpdate[]>]>> {
		try {
			const filePath = path.join(taskDirectory, GlobalFileNames.contextHistory)
			if (await fileExistsAtPath(filePath)) {
				const data = await fs.readFile(filePath, "utf8")
				const serializedUpdates = JSON.parse(data) as SerializedContextHistory

				// Update to properly reconstruct the tuple structure
				return new Map(
					serializedUpdates.map(([messageIndex, [numberValue, innerMapArray]]) => [
						messageIndex,
						[numberValue, new Map(innerMapArray)],
					]),
				)
			}
		} catch (error) {
			console.error("Failed to load context history:", error)
		}
		return new Map()
	}

	/**
	 * save the context history updates to disk
	 */
	private async saveContextHistory(taskDirectory: string) {
		try {
			const serializedUpdates: SerializedContextHistory = Array.from(this.contextHistoryUpdates.entries()).map(
				([messageIndex, [numberValue, innerMap]]) => [messageIndex, [numberValue, Array.from(innerMap.entries())]],
			)

			await fs.writeFile(
				path.join(taskDirectory, GlobalFileNames.contextHistory),
				JSON.stringify(serializedUpdates),
				"utf8",
			)
		} catch (error) {
			console.error("Failed to save context history:", error)
		}
	}

	/**
	 * Determine whether we should compact context window, based on token counts
	 */
	shouldCompactContextWindow(
		clineMessages: ClineMessage[],
		api: ApiHandler,
		previousApiReqIndex: number,
		thresholdPercentage?: number,
	): boolean {
		if (previousApiReqIndex >= 0) {
			const previousRequest = clineMessages[previousApiReqIndex]
			if (previousRequest && previousRequest.text) {
				const { tokensIn, tokensOut, cacheWrites, cacheReads }: ClineApiReqInfo = JSON.parse(previousRequest.text)
				const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)

				const { contextWindow, maxAllowedSize } = getContextWindowInfo(api)
				const roundedThreshold = thresholdPercentage ? Math.floor(contextWindow * thresholdPercentage) : maxAllowedSize
				const thresholdTokens = Math.min(roundedThreshold, maxAllowedSize)
				return totalTokens >= thresholdTokens
			}
		}
		return false
	}

	/**
	 * Get telemetry data for context management decisions
	 * Returns the token counts and context window info that drove summarization
	 */
	getContextTelemetryData(
		clineMessages: ClineMessage[],
		api: ApiHandler,
		triggerIndex?: number,
	): {
		tokensUsed: number
		maxContextWindow: number
	} | null {
		// Use provided triggerIndex or fallback to automatic detection
		let targetIndex: number
		if (triggerIndex !== undefined) {
			targetIndex = triggerIndex
		} else {
			// Find all API request indices
			const apiReqIndices = clineMessages
				.map((msg, index) => (msg.say === "api_req_started" ? index : -1))
				.filter((index) => index !== -1)

			// We want the second-to-last API request (the one that caused summarization)
			targetIndex = apiReqIndices.length >= 2 ? apiReqIndices[apiReqIndices.length - 2] : -1
		}

		if (targetIndex >= 0) {
			const targetRequest = clineMessages[targetIndex]
			if (targetRequest && targetRequest.text) {
				try {
					const { tokensIn, tokensOut, cacheWrites, cacheReads }: ClineApiReqInfo = JSON.parse(targetRequest.text)
					const tokensUsed = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)

					const { contextWindow } = getContextWindowInfo(api)

					return {
						tokensUsed,
						maxContextWindow: contextWindow,
					}
				} catch (error) {
					console.error("Error parsing API request info for context telemetry:", error)
				}
			}
		}
		return null
	}

	/**
	 * primary entry point for getting up to date context
	 */
	async getNewContextMessagesAndMetadata(
		apiConversationHistory: Anthropic.Messages.MessageParam[],
		clineMessages: ClineMessage[],
		api: ApiHandler,
		conversationHistoryDeletedRange: [number, number] | undefined,
		previousApiReqIndex: number,
		taskDirectory: string,
		useAutoCondense: boolean, // option to use new auto-condense or old programmatic context management
	) {
		let updatedConversationHistoryDeletedRange = false

		if (!useAutoCondense) {
			// If the previous API request's total token usage is close to the context window, truncate the conversation history to free up space for the new request
			if (previousApiReqIndex >= 0) {
				const previousRequest = clineMessages[previousApiReqIndex]
				if (previousRequest && previousRequest.text) {
					const timestamp = previousRequest.ts
					const { tokensIn, tokensOut, cacheWrites, cacheReads }: ClineApiReqInfo = JSON.parse(previousRequest.text)
					const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
					const { maxAllowedSize } = getContextWindowInfo(api)

					// This is the most reliable way to know when we're close to hitting the context window.
					if (totalTokens >= maxAllowedSize) {
						// Since the user may switch between models with different context windows, truncating half may not be enough (ie if switching from claude 200k to deepseek 64k, half truncation will only remove 100k tokens, but we need to remove much more)
						// So if totalTokens/2 is greater than maxAllowedSize, we truncate 3/4 instead of 1/2
						const keep = totalTokens / 2 > maxAllowedSize ? "quarter" : "half"

						// Attempt file read optimization and check if we need to truncate
						let { anyContextUpdates, needToTruncate } = this.attemptFileReadOptimizationCore(
							apiConversationHistory,
							conversationHistoryDeletedRange,
							timestamp,
						)

						if (needToTruncate) {
							// go ahead with truncation
							anyContextUpdates = this.applyStandardContextTruncationNoticeChange(timestamp) || anyContextUpdates

							// NOTE: it's okay that we overwriteConversationHistory in resume task since we're only ever removing the last user message and not anything in the middle which would affect this range
							conversationHistoryDeletedRange = this.getNextTruncationRange(
								apiConversationHistory,
								conversationHistoryDeletedRange,
								keep,
							)

							updatedConversationHistoryDeletedRange = true
						}

						// if we alter the context history, save the updated version to disk
						if (anyContextUpdates) {
							await this.saveContextHistory(taskDirectory)
						}
					}
				}
			}
		}

		const truncatedConversationHistory = this.getAndAlterTruncatedMessages(
			apiConversationHistory,
			conversationHistoryDeletedRange,
		)

		return {
			conversationHistoryDeletedRange: conversationHistoryDeletedRange,
			updatedConversationHistoryDeletedRange: updatedConversationHistoryDeletedRange,
			truncatedConversationHistory: truncatedConversationHistory,
		}
	}

	/**
	 * get truncation range
	 */
	public getNextTruncationRange(
		apiMessages: Anthropic.Messages.MessageParam[],
		currentDeletedRange: [number, number] | undefined,
		keep: "none" | "lastTwo" | "half" | "quarter",
	): [number, number] {
		// We always keep the first user-assistant pairing, and truncate an even number of messages from there
		const rangeStartIndex = 2 // index 0 and 1 are kept
		const startOfRest = currentDeletedRange ? currentDeletedRange[1] + 1 : 2 // inclusive starting index

		let messagesToRemove: number
		if (keep === "none") {
			// Removes all messages beyond the first core user/assistant message pair
			messagesToRemove = Math.max(apiMessages.length - startOfRest, 0)
		} else if (keep === "lastTwo") {
			// Keep the last user-assistant pair in addition to the first core user/assistant message pair
			messagesToRemove = Math.max(apiMessages.length - startOfRest - 2, 0)
		} else if (keep === "half") {
			// Remove half of remaining user-assistant pairs
			// We first calculate half of the messages then divide by 2 to get the number of pairs.
			// After flooring, we multiply by 2 to get the number of messages.
			// Note that this will also always be an even number.
			messagesToRemove = Math.floor((apiMessages.length - startOfRest) / 4) * 2 // Keep even number
		} else {
			// Remove 3/4 of remaining user-assistant pairs
			// We calculate 3/4ths of the messages then divide by 2 to get the number of pairs.
			// After flooring, we multiply by 2 to get the number of messages.
			// Note that this will also always be an even number.
			messagesToRemove = Math.floor(((apiMessages.length - startOfRest) * 3) / 4 / 2) * 2
		}

		let rangeEndIndex = startOfRest + messagesToRemove - 1 // inclusive ending index

		// Make sure that the last message being removed is a assistant message, so the next message after the initial user-assistant pair is an assistant message. This preserves the user-assistant-user-assistant structure.
		// NOTE: anthropic format messages are always user-assistant-user-assistant, while openai format messages can have multiple user messages in a row (we use anthropic format throughout cline)
		if (apiMessages[rangeEndIndex] && apiMessages[rangeEndIndex].role !== "assistant") {
			rangeEndIndex -= 1
		}

		// this is an inclusive range that will be removed from the conversation history
		return [rangeStartIndex, rangeEndIndex]
	}

	/**
	 * external interface to support old calls
	 */
	public getTruncatedMessages(
		messages: Anthropic.Messages.MessageParam[],
		deletedRange: [number, number] | undefined,
	): Anthropic.Messages.MessageParam[] {
		return this.getAndAlterTruncatedMessages(messages, deletedRange)
	}

	/**
	 * apply all required truncation methods to the messages in context
	 */
	private getAndAlterTruncatedMessages(
		messages: Anthropic.Messages.MessageParam[],
		deletedRange: [number, number] | undefined,
	): Anthropic.Messages.MessageParam[] {
		if (messages.length <= 1) {
			return messages
		}

		const updatedMessages = this.applyContextHistoryUpdates(messages, deletedRange ? deletedRange[1] + 1 : 2)

		// Validate and fix tool_use/tool_result pairing
		this.ensureToolResultsFollowToolUse(updatedMessages)

		// OLD NOTE: if you try to console log these, don't forget that logging a reference to an array may not provide the same result as logging a slice() snapshot of that array at that exact moment. The following DOES in fact include the latest assistant message.
		return updatedMessages
	}

	/**
	 * Ensures that every tool_use block in assistant messages has a corresponding tool_result in the next user message,
	 * and that tool_result blocks immediately follow their corresponding tool_use blocks
	 */
	private ensureToolResultsFollowToolUse(messages: Anthropic.Messages.MessageParam[]): void {
		for (let i = 0; i < messages.length - 1; i++) {
			const message = messages[i]

			// Only process assistant messages with content
			if (message.role !== "assistant" || !Array.isArray(message.content)) {
				continue
			}

			// Extract tool_use IDs in order
			const toolUseIds: string[] = []
			for (const block of message.content) {
				if (block.type === "tool_use" && block.id) {
					toolUseIds.push(block.id)
				}
			}

			// Skip if no tool_use blocks found
			if (toolUseIds.length === 0) {
				continue
			}

			const nextMessage = messages[i + 1]

			// Skip if next message is not a user message
			if (nextMessage.role !== "user") {
				continue
			}

			// Ensure content is an array
			if (!Array.isArray(nextMessage.content)) {
				nextMessage.content = []
			}

			// Separate tool_results from other blocks in a single pass
			const toolResultMap = new Map<string, Anthropic.Messages.ToolResultBlockParam>()
			const otherBlocks: Anthropic.Messages.ContentBlockParam[] = []
			let needsUpdate = false

			for (const block of nextMessage.content) {
				if (block.type === "tool_result" && block.tool_use_id) {
					toolResultMap.set(block.tool_use_id, block)
				} else {
					otherBlocks.push(block)
				}
			}

			// Check if reordering is needed (tool_results not at start in correct order)
			if (toolResultMap.size > 0) {
				let expectedIndex = 0
				for (let j = 0; j < nextMessage.content.length && expectedIndex < toolUseIds.length; j++) {
					const block = nextMessage.content[j]
					if (block.type === "tool_result" && block.tool_use_id === toolUseIds[expectedIndex]) {
						expectedIndex++
					} else if (block.type === "tool_result" || expectedIndex < toolUseIds.length) {
						needsUpdate = true
						break
					}
				}
				if (!needsUpdate && expectedIndex < toolResultMap.size) {
					needsUpdate = true
				}
			}

			// Add missing tool_results
			for (const toolUseId of toolUseIds) {
				if (!toolResultMap.has(toolUseId)) {
					toolResultMap.set(toolUseId, {
						type: "tool_result",
						tool_use_id: toolUseId,
						content: "result missing",
					})
					needsUpdate = true
				}
			}

			// Only modify if changes are needed
			if (!needsUpdate) {
				continue
			}

			// Build new content: tool_results first (in toolUseIds order), then other blocks
			const newContent: Anthropic.Messages.ContentBlockParam[] = []

			// Add tool_results in the order of toolUseIds
			const processedToolResults = new Set<string>()
			for (const toolUseId of toolUseIds) {
				const toolResult = toolResultMap.get(toolUseId)
				if (toolResult) {
					newContent.push(toolResult)
					processedToolResults.add(toolUseId)
				}
			}

			// Add all other blocks
			newContent.push(...otherBlocks)

			// Clone and update the message
			const clonedMessage = cloneDeep(nextMessage)
			clonedMessage.content = newContent
			messages[i + 1] = clonedMessage
		}
	}

	/**
	 * applies deletedRange truncation and other alterations based on changes in this.contextHistoryUpdates
	 */
	private applyContextHistoryUpdates(
		messages: Anthropic.Messages.MessageParam[],
		startFromIndex: number,
	): Anthropic.Messages.MessageParam[] {
		// runtime is linear in length of user messages, if expecting a limited number of alterations, could be more optimal to loop over alterations

		const firstChunk = messages.slice(0, 2) // get first user-assistant pair
		const secondChunk = messages.slice(startFromIndex) // get remaining messages within context
		const messagesToUpdate = [...firstChunk, ...secondChunk]

		// Remove orphaned tool_results from the first message after truncation (if it's a user message)
		if (startFromIndex > 2 && messagesToUpdate.length > 2) {
			const firstMessageAfterTruncation = messagesToUpdate[2]
			if (firstMessageAfterTruncation.role === "user" && Array.isArray(firstMessageAfterTruncation.content)) {
				const hasToolResults = firstMessageAfterTruncation.content.some((block) => block.type === "tool_result")
				if (hasToolResults) {
					// Clone and filter out all tool_result blocks
					messagesToUpdate[2] = cloneDeep(firstMessageAfterTruncation)
					;(messagesToUpdate[2].content as Anthropic.Messages.ContentBlockParam[]) = (
						firstMessageAfterTruncation.content as Anthropic.Messages.ContentBlockParam[]
					).filter((block) => block.type !== "tool_result")
				}
			}
		}

		// we need the mapping from the local indices in messagesToUpdate to the global array of updates in this.contextHistoryUpdates
		const originalIndices = [
			...Array(2).keys(),
			...Array(secondChunk.length)
				.fill(0)
				.map((_, i) => i + startFromIndex),
		]

		for (let arrayIndex = 0; arrayIndex < messagesToUpdate.length; arrayIndex++) {
			const messageIndex = originalIndices[arrayIndex]

			const innerTuple = this.contextHistoryUpdates.get(messageIndex)
			if (!innerTuple) {
				continue
			}

			// because we are altering this, we need a deep copy
			messagesToUpdate[arrayIndex] = cloneDeep(messagesToUpdate[arrayIndex])

			// Extract the map from the tuple
			const innerMap = innerTuple[1]
			for (const [blockIndex, changes] of innerMap) {
				// apply the latest change among n changes - [timestamp, updateType, update]
				const latestChange = changes[changes.length - 1]

				if (latestChange[1] === "text") {
					// only altering text for now
					const message = messagesToUpdate[arrayIndex]

					if (Array.isArray(message.content)) {
						const block = message.content[blockIndex]
						if (block) {
							this.setTextInBlock(block, latestChange[2][0])
						}
					}
				}
			}
		}

		return messagesToUpdate
	}

	/**
	 * removes all context history updates that occurred after the specified timestamp and saves to disk
	 */
	async truncateContextHistory(timestamp: number, taskDirectory: string): Promise<void> {
		this.truncateContextHistoryAtTimestamp(this.contextHistoryUpdates, timestamp)

		// save the modified context history to disk
		await this.saveContextHistory(taskDirectory)
	}

	/**
	 * alters the context history to remove all alterations after a given timestamp
	 * removes the index if there are no alterations there anymore, both outer and inner indices
	 */
	private truncateContextHistoryAtTimestamp(
		contextHistory: Map<number, [number, Map<number, ContextUpdate[]>]>,
		timestamp: number,
	): void {
		for (const [messageIndex, [_, innerMap]] of contextHistory) {
			// track which blockIndices to delete
			const blockIndicesToDelete: number[] = []

			// loop over the innerIndices of the messages in this block
			for (const [blockIndex, updates] of innerMap) {
				// updates ordered by timestamp, so find cutoff point by iterating from right to left
				let cutoffIndex = updates.length - 1
				while (cutoffIndex >= 0 && updates[cutoffIndex][0] > timestamp) {
					cutoffIndex--
				}

				// If we found updates to remove
				if (cutoffIndex < updates.length - 1) {
					// Modify the array in place to keep only updates up to cutoffIndex
					updates.length = cutoffIndex + 1

					// If no updates left after truncation, mark this block for deletion
					if (updates.length === 0) {
						blockIndicesToDelete.push(blockIndex)
					}
				}
			}

			// Remove empty blocks from inner map
			for (const blockIndex of blockIndicesToDelete) {
				innerMap.delete(blockIndex)
			}

			// If inner map is now empty, remove the message index from outer map
			if (innerMap.size === 0) {
				contextHistory.delete(messageIndex)
			}
		}
	}

	/**
	 * applies the context optimization steps and returns whether any changes were made
	 */
	public applyContextOptimizations(
		apiMessages: Anthropic.Messages.MessageParam[],
		startFromIndex: number,
		timestamp: number,
	): [boolean, Set<number>] {
		const [fileReadUpdatesBool, uniqueFileReadIndices] = this.findAndPotentiallySaveFileReadContextHistoryUpdates(
			apiMessages,
			startFromIndex,
			timestamp,
		)

		// true if any context optimization steps alter state
		const contextHistoryUpdated = fileReadUpdatesBool

		return [contextHistoryUpdated, uniqueFileReadIndices]
	}

	/**
	 * Private helper that attempts file read optimization and checks threshold.
	 */
	private attemptFileReadOptimizationCore(
		apiConversationHistory: Anthropic.Messages.MessageParam[],
		conversationHistoryDeletedRange: [number, number] | undefined,
		timestamp: number,
	): {
		anyContextUpdates: boolean
		needToTruncate: boolean
	} {
		const startIndex = conversationHistoryDeletedRange ? conversationHistoryDeletedRange[1] + 1 : 2

		const [anyContextUpdates, uniqueFileReadIndices] = this.applyContextOptimizations(
			apiConversationHistory,
			startIndex,
			timestamp,
		)

		if (!anyContextUpdates) {
			return { anyContextUpdates: false, needToTruncate: true }
		}

		const percentSaved = this.calculateContextOptimizationMetrics(
			apiConversationHistory,
			conversationHistoryDeletedRange,
			uniqueFileReadIndices,
		)

		return {
			anyContextUpdates: true,
			needToTruncate: percentSaved < 0.3,
		}
	}

	/**
	 * Public helper that attempts file read optimization and saves to disk.
	 */
	async attemptFileReadOptimization(
		apiConversationHistory: Anthropic.Messages.MessageParam[],
		conversationHistoryDeletedRange: [number, number] | undefined,
		clineMessages: ClineMessage[],
		previousApiReqIndex: number,
		taskDirectory: string,
	): Promise<boolean> {
		// Extract timestamp using same logic as getNewContextMessagesAndMetadata
		if (previousApiReqIndex < 0) {
			return true
		}

		const previousRequest = clineMessages[previousApiReqIndex]
		if (!previousRequest || !previousRequest.text) {
			return true
		}

		const timestamp = previousRequest.ts

		const { anyContextUpdates, needToTruncate } = this.attemptFileReadOptimizationCore(
			apiConversationHistory,
			conversationHistoryDeletedRange,
			timestamp,
		)

		if (anyContextUpdates) {
			await this.saveContextHistory(taskDirectory)
		}

		return needToTruncate
	}

	/**
	 * Public function for triggering potentially setting the truncation message
	 * If the truncation message already exists, does nothing, otherwise adds the message
	 */
	async triggerApplyStandardContextTruncationNoticeChange(
		timestamp: number,
		taskDirectory: string,
		apiConversationHistory: Anthropic.Messages.MessageParam[],
	) {
		const assistantUpdated = this.applyStandardContextTruncationNoticeChange(timestamp)
		const userUpdated = this.applyFirstUserMessageReplacement(timestamp, apiConversationHistory)
		if (assistantUpdated || userUpdated) {
			await this.saveContextHistory(taskDirectory)
		}
	}

	/**
	 * if there is any truncation and there is no other alteration already set, alter the assistant message to indicate this occurred
	 */
	private applyStandardContextTruncationNoticeChange(timestamp: number): boolean {
		if (!this.contextHistoryUpdates.has(1)) {
			// first assistant message always at index 1
			const innerMap = new Map<number, ContextUpdate[]>()
			innerMap.set(0, [[timestamp, "text", [formatResponse.contextTruncationNotice()], []]])
			this.contextHistoryUpdates.set(1, [0, innerMap]) // EditType is undefined for first assistant message
			return true
		}
		return false
	}

	/**
	 * Replace the first user message when context window is compacted
	 */
	private applyFirstUserMessageReplacement(
		timestamp: number,
		apiConversationHistory: Anthropic.Messages.MessageParam[],
	): boolean {
		if (!this.contextHistoryUpdates.has(0)) {
			try {
				// choosing to be extra careful here, but likely not required
				let firstUserMessage = ""

				const message = apiConversationHistory[0]
				if (Array.isArray(message.content)) {
					const block = message.content[0]
					if (block && block.type === "text") {
						firstUserMessage = block.text
					}
				}

				if (firstUserMessage) {
					const processedFirstUserMessage = formatResponse.processFirstUserMessageForTruncation()

					const innerMap = new Map<number, ContextUpdate[]>()
					innerMap.set(0, [[timestamp, "text", [processedFirstUserMessage], []]])
					this.contextHistoryUpdates.set(0, [0, innerMap]) // same EditType as first assistant truncation notice

					return true
				}
			} catch (error) {
				console.error("applyFirstUserMessageReplacement:", error)
			}
		}
		return false
	}

	/**
	 * wraps the logic for determining file reads to overwrite, and altering state
	 * returns whether any updates were made (bool) and indices where updates were made
	 */
	private findAndPotentiallySaveFileReadContextHistoryUpdates(
		apiMessages: Anthropic.Messages.MessageParam[],
		startFromIndex: number,
		timestamp: number,
	): [boolean, Set<number>] {
		const [fileReadIndices, messageFilePaths] = this.getPossibleDuplicateFileReads(apiMessages, startFromIndex)
		return this.applyFileReadContextHistoryUpdates(fileReadIndices, messageFilePaths, apiMessages, timestamp)
	}

	/**
	 * generate a mapping from unique file reads from multiple tool calls to their outer index position(s)
	 * also return additional metadata to support multiple file reads in file mention text blocks
	 */
	private getPossibleDuplicateFileReads(
		apiMessages: Anthropic.Messages.MessageParam[],
		startFromIndex: number,
	): [Map<string, [number, number, string, string, number][]>, Map<number, string[]>] {
		// fileReadIndices: { fileName => [outerIndex, EditType, searchText, replaceText, innerIndex] }
		// messageFilePaths: { outerIndex => [fileRead1, fileRead2, ..] }
		// searchText in fileReadIndices is only required for file mention file-reads since there can be more than one file in the text
		// searchText will be the empty string "" in the case that it's not required, for non-file mentions
		// messageFilePaths is only used for file mentions as there can be multiple files read in the same text chunk

		// for all text blocks per file, has info for updating the block
		// originally our messages were formatted where the innerIndex was consistently at index=1, but that is no longer the case
		// which is why we now need to support both an outerIndex and innerIndex in this mapping
		const fileReadIndices = new Map<string, [number, number, string, string, number][]>()

		// for file mention text blocks, track all the unique files read
		const messageFilePaths = new Map<number, string[]>()

		for (let i = startFromIndex; i < apiMessages.length; i++) {
			let thisExistingFileReads: string[] = []

			if (this.contextHistoryUpdates.has(i)) {
				const innerTuple = this.contextHistoryUpdates.get(i)

				if (innerTuple) {
					// safety check
					const editType = innerTuple[0]

					if (editType === EditType.FILE_MENTION) {
						const innerMap = innerTuple[1]

						// Get the first entry from the innerMap since we only process one inner block index for FILE_MENTION
						const blockUpdates = innerMap.values().next().value

						// if we have updated this text previously, we want to check whether the lists of files in the metadata are the same
						if (blockUpdates && blockUpdates.length > 0) {
							// the first list indicates the files we have replaced in this text, second list indicates all unique files in this text
							// if they are equal then we have replaced all the files in this text already, and can ignore further processing
							if (
								blockUpdates[blockUpdates.length - 1][3][0].length ===
								blockUpdates[blockUpdates.length - 1][3][1].length
							) {
								continue
							}
							// otherwise there are still file reads here we can overwrite, so still need to process this text chunk
							// to do so we need to keep track of which files we've already replaced so we don't replace them again
							else {
								thisExistingFileReads = blockUpdates[blockUpdates.length - 1][3][0]
							}
						}
					} else {
						// for all other cases we can assume that we dont need to check this again
						continue
					}
				}
			}

			const message = apiMessages[i]
			if (message.role === "user" && Array.isArray(message.content) && message.content.length > 0) {
				const firstBlock = message.content[0]
				// Extract text from either a direct text block or from inside a tool_result wrapper (native tool calling)
				const firstBlockText = this.getTextFromBlock(firstBlock)

				if (firstBlockText) {
					const result = this.parseToolCallWithFormat(firstBlockText)
					let foundNormalFileRead = false
					if (result) {
						const [toolName, filePath, contentBlockIndex, headerText] = result

						if (toolName === "read_file") {
							// For native tool calling format, we assume contentBlockIndex=0 which is what happens naturally
							this.handleReadFileToolCall(i, filePath, fileReadIndices, contentBlockIndex, headerText)
							foundNormalFileRead = true
						} else if (toolName === "replace_in_file" || toolName === "write_to_file") {
							// For native tool calling format, the content is assumed to always in the same block (index=0 inside tool_result)
							// For the XML format, the old format has the file contents in index=1 whereas the new format has it in index=0
							let blockText: string | undefined
							if (firstBlock.type === "tool_result") {
								blockText = firstBlockText
							} else if (contentBlockIndex === 0) {
								// remaining cases are for type="text"
								blockText = firstBlockText
							} else if (contentBlockIndex === 1 && message.content.length > 1) {
								const secondBlock = message.content[1]
								if (secondBlock.type === "text") {
									blockText = secondBlock.text
								}
							}

							if (blockText) {
								this.handlePotentialFileChangeToolCalls(
									i,
									filePath,
									blockText,
									fileReadIndices,
									contentBlockIndex,
								)
								foundNormalFileRead = true
							}
						}
					}

					// file mentions can happen in most other user message blocks
					if (!foundNormalFileRead) {
						// search over indices 0-2 inclusive for file mentions
						// this is a heuristic to catch most occurrences without looping over all inner indices
						for (const candidateIndex of [0, 1, 2]) {
							if (candidateIndex >= message.content.length) {
								break
							}

							const block = message.content[candidateIndex]
							// Extract text from either a direct text block or from inside a tool_result wrapper
							const blockText = this.getTextFromBlock(block)
							if (blockText) {
								const [hasFileRead, filePaths] = this.handlePotentialFileMentionCalls(
									i,
									blockText,
									fileReadIndices,
									thisExistingFileReads, // file reads we've already replaced in this text in the latest version of this updated text
									candidateIndex,
								)
								if (hasFileRead) {
									messageFilePaths.set(i, filePaths) // all file paths in this string
									break // at most one file mentions block per outer index
								}
							}
						}
					}
				}
			}
		}

		return [fileReadIndices, messageFilePaths]
	}

	/**
	 * handles potential file content mentions in text blocks
	 * there will not be more than one of the same file read in a text block
	 */
	private handlePotentialFileMentionCalls(
		i: number,
		blockText: string,
		fileReadIndices: Map<string, [number, number, string, string, number][]>,
		thisExistingFileReads: string[],
		innerIndex: number,
	): [boolean, string[]] {
		const pattern = /<file_content path="([^"]*)">([\s\S]*?)<\/file_content>/g

		let foundMatch = false
		const filePaths: string[] = []

		for (const match of blockText.matchAll(pattern)) {
			foundMatch = true

			const filePath = match[1]
			filePaths.push(filePath) // we will record all unique paths from file mentions in this text

			// we can assume that thisExistingFileReads does not have many entries
			if (!thisExistingFileReads.includes(filePath)) {
				// meaning we haven't already replaced this file read

				const entireMatch = match[0] // The entire matched string

				// Create the replacement text - keep the tags but replace the content
				const replacementText = `<file_content path="${filePath}">${formatResponse.duplicateFileReadNotice()}</file_content>`

				const indices = fileReadIndices.get(filePath) || []
				// use the actual inner index where file mentions were found
				indices.push([i, EditType.FILE_MENTION, entireMatch, replacementText, innerIndex])
				fileReadIndices.set(filePath, indices)
			}
		}

		return [foundMatch, filePaths]
	}

	/**
	 * Parses tool call formats and returns null if no acceptable format is found
	 * Supports older version (content in separate block), and newer (content in same block)
	 * Returns [toolName, filePath, contentBlockIndex, headerText]
	 */
	private parseToolCallWithFormat(text: string): [string, string, number, string] | null {
		const match = text.match(/^\[([^\s]+) for '([^']+)'\] Result:/)

		if (!match) {
			return null
		}

		const headerLength = match[0].length
		let contentBlockIndex = 1
		if (text.length > headerLength) {
			// newer format: content follows header in this block (index 0)
			// in the older format the content is in the following block (index 1)
			contentBlockIndex = 0
		}

		return [match[1], match[2], contentBlockIndex, match[0]]
	}

	/**
	 * file_read tool call always pastes the file, so this is always a hit
	 */
	private handleReadFileToolCall(
		i: number,
		filePath: string,
		fileReadIndices: Map<string, [number, number, string, string, number][]>,
		contentBlockIndex: number,
		headerText: string,
	) {
		const indices = fileReadIndices.get(filePath) || []

		if (contentBlockIndex === 1) {
			// the original tool call format
			indices.push([i, EditType.READ_FILE_TOOL, "", formatResponse.duplicateFileReadNotice(), contentBlockIndex])
		} else {
			// the new tool call format (index=0)
			// in the new format the tool call output for read_file is appended to the tool call header with a newline separator
			// this means we need to extract just the header and append the duplicateFileReadNotice to it with the separator
			indices.push([
				i,
				EditType.READ_FILE_TOOL,
				"",
				headerText + "\n" + formatResponse.duplicateFileReadNotice(),
				contentBlockIndex,
			])
		}

		fileReadIndices.set(filePath, indices)
	}

	/**
	 * write_to_file and replace_in_file tool output are handled similarly
	 */
	private handlePotentialFileChangeToolCalls(
		i: number,
		filePath: string,
		blockText: string,
		fileReadIndices: Map<string, [number, number, string, string, number][]>,
		contentBlockIndex: number,
	) {
		const pattern = /(<final_file_content path="[^"]*">)[\s\S]*?(<\/final_file_content>)/

		// check if this exists in the text, it won't exist if the user rejects the file change for example
		if (pattern.test(blockText)) {
			const replacementText = blockText.replace(pattern, `$1 ${formatResponse.duplicateFileReadNotice()} $2`)
			const indices = fileReadIndices.get(filePath) || []
			indices.push([i, EditType.ALTER_FILE_TOOL, "", replacementText, contentBlockIndex])
			fileReadIndices.set(filePath, indices)
		}
	}

	/**
	 * alter all occurrences of file read operations and track which messages were updated
	 * returns the outer index of messages we alter, to count number of changes
	 */
	private applyFileReadContextHistoryUpdates(
		fileReadIndices: Map<string, [number, number, string, string, number][]>,
		messageFilePaths: Map<number, string[]>,
		apiMessages: Anthropic.Messages.MessageParam[],
		timestamp: number,
	): [boolean, Set<number>] {
		let didUpdate = false
		const updatedMessageIndices = new Set<number>() // track which messages we update on this round
		const fileMentionUpdates = new Map<number, [string, string[], number]>() // [baseText, prevFilesReplaced, innerIndex]

		for (const [filePath, indices] of fileReadIndices.entries()) {
			// Only process if there are multiple reads of the same file, else we will want to keep the latest read of the file
			if (indices.length > 1) {
				// Process all but the last index, as we will keep that instance of the file read
				for (let i = 0; i < indices.length - 1; i++) {
					const messageIndex = indices[i][0]
					const messageType = indices[i][1] // EditType value
					const searchText = indices[i][2] // search text (for file mentions, else empty string)
					const messageString = indices[i][3] // what we will replace the string with
					const innerIndex = indices[i][4] // inner block index where we are making the change

					didUpdate = true
					updatedMessageIndices.add(messageIndex)

					// for single-fileread text we can set the updates here
					// for potential multi-fileread text we need to determine all changes & iteratively update the text prior to saving the final change
					if (messageType === EditType.FILE_MENTION) {
						if (!fileMentionUpdates.has(messageIndex)) {
							// Get base text either from existing updates or from apiMessages
							let baseText = ""
							let prevFilesReplaced: string[] = []

							const innerTuple = this.contextHistoryUpdates.get(messageIndex)
							if (innerTuple) {
								const blockUpdates = innerTuple[1].get(innerIndex)
								if (blockUpdates && blockUpdates.length > 0) {
									baseText = blockUpdates[blockUpdates.length - 1][2][0] // index 0 of MessageContent
									prevFilesReplaced = blockUpdates[blockUpdates.length - 1][3][0] // previously overwritten file reads in this text
								}
							}

							// can assume that this content will exist, otherwise it would not have been in fileReadIndices
							const messageContent = apiMessages[messageIndex]?.content
							if (!baseText && Array.isArray(messageContent) && messageContent.length > innerIndex) {
								// contentBlock can either be the type="text" dict or type="tool_result" dict which has its own content array
								// but we currently assume the content we will overwrite is at index=0 in this content array
								const contentBlock = messageContent[innerIndex]
								const extractedText = this.getTextFromBlock(contentBlock)
								if (extractedText) {
									baseText = extractedText
								}
							}

							// prevFilesReplaced keeps track of the previous file reads we've replace in this string, empty array if none
							fileMentionUpdates.set(messageIndex, [baseText, prevFilesReplaced, innerIndex])
						}

						// Replace searchText with messageString for all file reads we need to replace in this text
						if (searchText) {
							const currentTuple = fileMentionUpdates.get(messageIndex) || ["", [], 0]
							if (currentTuple[0]) {
								// safety check
								// replace this text chunk
								const updatedText = currentTuple[0].replace(searchText, messageString)

								// add the newly added filePath read
								const updatedFileReads = currentTuple[1]
								updatedFileReads.push(filePath)

								fileMentionUpdates.set(messageIndex, [updatedText, updatedFileReads, currentTuple[2]])
							}
						}
					} else {
						const innerTuple = this.contextHistoryUpdates.get(messageIndex)
						let innerMap: Map<number, ContextUpdate[]>

						if (!innerTuple) {
							innerMap = new Map<number, ContextUpdate[]>()
							this.contextHistoryUpdates.set(messageIndex, [messageType, innerMap])
						} else {
							innerMap = innerTuple[1]
						}

						const blockIndex = innerIndex

						const updates = innerMap.get(blockIndex) || []

						// metadata array is empty for non-file mention occurrences
						updates.push([timestamp, "text", [messageString], []])

						innerMap.set(blockIndex, updates)
					}
				}
			}
		}

		// apply file mention updates to contextHistoryUpdates
		// in fileMentionUpdates, filePathsUpdated includes all the file paths which are updated in the latest version of this altered text
		for (const [messageIndex, [updatedText, filePathsUpdated, blockIndex]] of fileMentionUpdates.entries()) {
			const innerTuple = this.contextHistoryUpdates.get(messageIndex)
			let innerMap: Map<number, ContextUpdate[]>

			if (!innerTuple) {
				innerMap = new Map<number, ContextUpdate[]>()
				this.contextHistoryUpdates.set(messageIndex, [EditType.FILE_MENTION, innerMap])
			} else {
				innerMap = innerTuple[1]
			}

			const updates = innerMap.get(blockIndex) || []

			// filePathsUpdated includes changes done previously to this timestamp, and right now
			if (messageFilePaths.has(messageIndex)) {
				const allFileReads = messageFilePaths.get(messageIndex)
				if (allFileReads) {
					// we gather all the file reads possible in this text from messageFilePaths
					// filePathsUpdated from fileMentionUpdates stores all the files reads we have replaced now & previously
					updates.push([timestamp, "text", [updatedText], [filePathsUpdated, allFileReads]])
					innerMap.set(blockIndex, updates)
				}
			}
		}

		return [didUpdate, updatedMessageIndices]
	}

	/**
	 * count total characters in messages and total savings within this range
	 */
	private countCharactersAndSavingsInRange(
		apiMessages: Anthropic.Messages.MessageParam[],
		startIndex: number,
		endIndex: number,
		uniqueFileReadIndices: Set<number>,
	): { totalCharacters: number; charactersSaved: number } {
		let totalCharCount = 0
		let totalCharactersSaved = 0

		for (let i = startIndex; i < endIndex; i++) {
			// looping over the outer indices of messages
			const message = apiMessages[i]

			if (!message.content) {
				continue
			}

			// hasExistingAlterations checks whether the outer idnex has any changes
			// hasExistingAlterations will also include the alterations we just made
			const hasExistingAlterations = this.contextHistoryUpdates.has(i)
			const hasNewAlterations = uniqueFileReadIndices.has(i)

			if (Array.isArray(message.content)) {
				for (let blockIndex = 0; blockIndex < message.content.length; blockIndex++) {
					// looping over inner indices of messages
					const block = message.content[blockIndex]

					// Extract text from either a direct text block or from inside a tool_result wrapper (native tool calling)
					const blockText = this.getTextFromBlock(block)
					if (blockText) {
						// true if we just altered it, or it was altered before
						if (hasExistingAlterations) {
							const innerTuple = this.contextHistoryUpdates.get(i)
							const updates = innerTuple?.[1].get(blockIndex) // updated text for this inner index

							if (updates && updates.length > 0) {
								// exists if we have an update for the message at this index
								const latestUpdate = updates[updates.length - 1]

								// if block was just altered, then calculate savings
								if (hasNewAlterations) {
									let originalTextLength: number
									if (updates.length > 1) {
										originalTextLength = updates[updates.length - 2][2][0].length // handles case if we have multiple updates for same text block
									} else {
										originalTextLength = blockText.length
									}

									const newTextLength = latestUpdate[2][0].length // replacement text
									totalCharactersSaved += originalTextLength - newTextLength

									totalCharCount += originalTextLength
								} else {
									// meaning there was an update to this text previously, but we didn't just alter it
									totalCharCount += latestUpdate[2][0].length
								}
							} else {
								// reach here if there was one inner index with an update, but now we are at a different index, so updates is not defined
								totalCharCount += blockText.length
							}
						} else {
							// reach here if there's no alterations for this outer index, meaning each inner index won't have any changes either
							totalCharCount += blockText.length
						}
					} else if (block.type === "image" && block.source) {
						if (block.source.type === "base64" && block.source.data) {
							totalCharCount += block.source.data.length
						}
					}
				}
			}
		}

		return { totalCharacters: totalCharCount, charactersSaved: totalCharactersSaved }
	}

	/**
	 * count total percentage character savings across in-range conversation
	 */
	private calculateContextOptimizationMetrics(
		apiMessages: Anthropic.Messages.MessageParam[],
		conversationHistoryDeletedRange: [number, number] | undefined,
		uniqueFileReadIndices: Set<number>,
	): number {
		// count for first user-assistant message pair
		const firstChunkResult = this.countCharactersAndSavingsInRange(apiMessages, 0, 2, uniqueFileReadIndices)

		// count for the remaining in-range messages
		const secondChunkResult = this.countCharactersAndSavingsInRange(
			apiMessages,
			conversationHistoryDeletedRange ? conversationHistoryDeletedRange[1] + 1 : 2,
			apiMessages.length,
			uniqueFileReadIndices,
		)

		const totalCharacters = firstChunkResult.totalCharacters + secondChunkResult.totalCharacters
		const totalCharactersSaved = firstChunkResult.charactersSaved + secondChunkResult.charactersSaved

		const percentCharactersSaved = totalCharacters === 0 ? 0 : totalCharactersSaved / totalCharacters

		return percentCharactersSaved
	}
}
