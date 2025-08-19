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
	shouldCompactContextWindow(clineMessages: ClineMessage[], api: ApiHandler, previousApiReqIndex: number): boolean {
		if (previousApiReqIndex >= 0) {
			const previousRequest = clineMessages[previousApiReqIndex]
			if (previousRequest && previousRequest.text) {
				const { tokensIn, tokensOut, cacheWrites, cacheReads }: ClineApiReqInfo = JSON.parse(previousRequest.text)
				const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)

				const { maxAllowedSize } = getContextWindowInfo(api)
				return totalTokens >= maxAllowedSize
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
		let targetIndex
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
		_clineMessages: ClineMessage[],
		_api: ApiHandler,
		conversationHistoryDeletedRange: [number, number] | undefined,
		_previousApiReqIndex: number,
		_taskDirectory: string,
	) {
		const updatedConversationHistoryDeletedRange = false

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
		if (apiMessages[rangeEndIndex].role !== "assistant") {
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

		// OLD NOTE: if you try to console log these, don't forget that logging a reference to an array may not provide the same result as logging a slice() snapshot of that array at that exact moment. The following DOES in fact include the latest assistant message.
		return updatedMessages
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
						if (block && block.type === "text") {
							block.text = latestChange[2][0]
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
	 * Public function for triggering potentially setting the truncation message
	 * If the truncation message already exists, does nothing, otherwise adds the message
	 */
	async triggerApplyStandardContextTruncationNoticeChange(timestamp: number, taskDirectory: string) {
		/*
        const assistantUpdated = this.applyStandardContextTruncationNoticeChange(timestamp)
		const userUpdated = this.applyFirstUserMessageReplacement(timestamp)
		if (assistantUpdated || userUpdated)
		*/
		const updated = this.applyStandardContextTruncationNoticeChange(timestamp)
		if (updated) {
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
}
