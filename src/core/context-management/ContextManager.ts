import { Anthropic } from "@anthropic-ai/sdk"
import { ClineApiReqInfo, ClineMessage } from "../../shared/ExtensionMessage"
import { ApiHandler } from "../../api"
import { OpenAiHandler } from "../../api/providers/openai"
import { formatResponse } from "../prompts/responses"
import { GlobalFileNames } from "../../global-constants"
import { fileExistsAtPath } from "../../utils/fs"
import * as path from "path"
import fs from "fs/promises"
import cloneDeep from "clone-deep"

// array of string values allows us to cover all changes currently
export type MessageContent = string[]

// Type for a single context update
type ContextUpdate = [number, string, MessageContent] // [timestamp, updateType, update]

// Type for the serialized format of our nested maps
type SerializedContextHistory = Array<
	[
		number, // messageIndex
		Array<
			[
				number, // blockIndex
				ContextUpdate[], // updates array
			]
		>,
	]
>

export class ContextManager {
	// mapping from the apiMessages outer index to the inner message index to a list of actual changes, ordered by timestamp
	// timestamp is required in order to support full checkpointing, where the changes we apply need to be able to be undone when
	// moving to an earlier conversation history checkpoint - this ordering intuitively allows for binary search on truncation

	// format:  {outerIndex => {innerIndex => [[timestamp, updateType, update], ...]}}
	// example: { 1 => { 0 => [[<timestamp>, "text", "[NOTE] Some previous conversation history with the user has been removed ..."], ...] } }
	// the above example would be how we update the first assistant message to indicate we truncated text
	private contextHistoryUpdates: Map<number, Map<number, ContextUpdate[]>>

	constructor() {
		this.contextHistoryUpdates = new Map()
	}

	/**
	 * public function for loading contextHistory from memory, if it exists
	 */
	async initializeContextHistory(taskDirectory: string) {
		this.contextHistoryUpdates = await this.getSavedContextHistory(taskDirectory)
	}

	/**
	 * get the stored context history from disk
	 */
	private async getSavedContextHistory(taskDirectory: string): Promise<Map<number, Map<number, ContextUpdate[]>>> {
		try {
			const filePath = path.join(taskDirectory, GlobalFileNames.contextHistory)
			if (await fileExistsAtPath(filePath)) {
				const data = await fs.readFile(filePath, "utf8")
				const serializedUpdates = JSON.parse(data) as SerializedContextHistory

				return new Map(serializedUpdates.map(([messageIndex, innerMapArray]) => [messageIndex, new Map(innerMapArray)]))
			}
		} catch (error) {
			console.error("Failed to load context history:", error)
		}
		return new Map()
	}

	/**
	 * save the context history to disk
	 */
	private async saveContextHistory(taskDirectory: string) {
		try {
			// Convert Map to our defined serialized format
			const serializedUpdates: SerializedContextHistory = Array.from(this.contextHistoryUpdates.entries()).map(
				([messageIndex, innerMap]) => [messageIndex, Array.from(innerMap.entries())],
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
	 * primary entry point for getting up to date context & truncating when required
	 */
	async getNewContextMessagesAndMetadata(
		apiConversationHistory: Anthropic.Messages.MessageParam[],
		clineMessages: ClineMessage[],
		api: ApiHandler,
		conversationHistoryDeletedRange: [number, number] | undefined,
		previousApiReqIndex: number,
		taskDirectory: string,
	) {
		let updatedConversationHistoryDeletedRange = false

		// If the previous API request's total token usage is close to the context window, truncate the conversation history to free up space for the new request
		if (previousApiReqIndex >= 0) {
			const previousRequest = clineMessages[previousApiReqIndex]
			if (previousRequest && previousRequest.text) {
				const timestamp = previousRequest.ts
				const { tokensIn, tokensOut, cacheWrites, cacheReads }: ClineApiReqInfo = JSON.parse(previousRequest.text)
				const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
				let contextWindow = api.getModel().info.contextWindow || 128_000
				// FIXME: hack to get anyone using openai compatible with deepseek to have the proper context window instead of the default 128k. We need a way for the user to specify the context window for models they input through openai compatible
				if (api instanceof OpenAiHandler && api.getModel().id.toLowerCase().includes("deepseek")) {
					contextWindow = 64_000
				}
				let maxAllowedSize: number
				switch (contextWindow) {
					case 64_000: // deepseek models
						maxAllowedSize = contextWindow - 27_000
						break
					case 128_000: // most models
						maxAllowedSize = contextWindow - 30_000
						break
					case 200_000: // claude models
						maxAllowedSize = contextWindow - 40_000
						break
					default:
						maxAllowedSize = Math.max(contextWindow - 40_000, contextWindow * 0.8) // for deepseek, 80% of 64k meant only ~10k buffer which was too small and resulted in users getting context window errors.
				}

				// This is the most reliable way to know when we're close to hitting the context window.
				if (totalTokens >= maxAllowedSize) {
					// Since the user may switch between models with different context windows, truncating half may not be enough (ie if switching from claude 200k to deepseek 64k, half truncation will only remove 100k tokens, but we need to remove much more)
					// So if totalTokens/2 is greater than maxAllowedSize, we truncate 3/4 instead of 1/2
					const keep = totalTokens / 2 > maxAllowedSize ? "quarter" : "half"

					// currently if we are able to trim context we will optimistically continue
					let [anyContextUpdates, uniqueFileReadIndices] = this.applyContextOptimizations(
						apiConversationHistory,
						conversationHistoryDeletedRange ? conversationHistoryDeletedRange[1] + 1 : 2,
						timestamp,
					)

					let needToTruncate = true
					if (anyContextUpdates) {
						// determine whether we've saved enough chars to not truncate
						const charactersSavedPercentage = this.calculateContextOptimizationMetrics(
							apiConversationHistory,
							conversationHistoryDeletedRange,
							uniqueFileReadIndices,
						)
						if (charactersSavedPercentage >= 0.3) {
							needToTruncate = false
						}
					}

					if (needToTruncate) {
						// go ahead with truncation
						anyContextUpdates = anyContextUpdates || this.applyStandardContextTruncationNoticeChange(timestamp)

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
		keep: "half" | "quarter",
	): [number, number] {
		// We always keep the first user-assistant pairing, and truncate an even number of messages from there
		const rangeStartIndex = 2 // index 0 and 1 are kept
		const startOfRest = currentDeletedRange ? currentDeletedRange[1] + 1 : 2 // inclusive starting index

		let messagesToRemove: number
		if (keep === "half") {
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

			const innerMap = this.contextHistoryUpdates.get(messageIndex)
			if (!innerMap) {
				continue
			}

			// because we are altering this, we need a deep copy
			messagesToUpdate[arrayIndex] = cloneDeep(messagesToUpdate[arrayIndex])

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
		contextHistory: Map<number, Map<number, ContextUpdate[]>>,
		timestamp: number,
	): void {
		for (const [messageIndex, innerMap] of contextHistory) {
			// track which blockIndices to delete
			const blockIndicesToDelete: number[] = []

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
	private applyContextOptimizations(
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
	 * if there is any truncation, and there is no other alteration already set, alter the assistant message to indicate this occurred
	 */
	private applyStandardContextTruncationNoticeChange(timestamp: number): boolean {
		if (!this.contextHistoryUpdates.has(1)) {
			// first assistant message always at index 1
			const innerMap = new Map<number, ContextUpdate[]>()
			innerMap.set(0, [[timestamp, "text", [formatResponse.contextTruncationNotice()]]]) // alter message text at index 0
			this.contextHistoryUpdates.set(1, innerMap)
			return true
		}
		return false
	}

	/**
	 * wraps the logic for determining file reads to overwrite, and altering state
	 */
	private findAndPotentiallySaveFileReadContextHistoryUpdates(
		apiMessages: Anthropic.Messages.MessageParam[],
		startFromIndex: number,
		timestamp: number,
	): [boolean, Set<number>] {
		const fileReadIndices = this.getPossibleDuplicateFileReads(apiMessages, startFromIndex)
		return this.applyFileReadContextHistoryUpdates(fileReadIndices, timestamp)
	}

	/**
	 * generate a mapping from unique file reads from multiple tool calls to their outer index position(s)
	 */
	private getPossibleDuplicateFileReads(
		apiMessages: Anthropic.Messages.MessageParam[],
		startFromIndex: number,
	): Map<string, [number, string][]> {
		const fileReadIndices = new Map<string, [number, string][]>() // for a unique file, all outer indices its read at & the string to replace it with

		for (let i = startFromIndex; i < apiMessages.length; i++) {
			// for now we assume there's no need to check if we've already adjusted this message
			if (this.contextHistoryUpdates.has(i)) {
				continue
			}

			const message = apiMessages[i]
			if (message.role === "user" && Array.isArray(message.content) && message.content.length > 0) {
				const firstBlock = message.content[0]
				if (firstBlock.type === "text") {
					const matchTup = this.parsePotentialToolCall(firstBlock.text)
					if (matchTup) {
						if (matchTup[0] === "read_file") {
							this.handleReadFileToolCall(i, matchTup[1], fileReadIndices)
						} else if (matchTup[0] === "replace_in_file" || matchTup[0] === "write_to_file") {
							if (message.content.length > 1) {
								const secondBlock = message.content[1]
								if (secondBlock.type === "text") {
									this.handlePotentialFileChangeToolCalls(i, matchTup[1], secondBlock.text, fileReadIndices)
								}
							}
						}

						// this will match other tool calls, ignore those
					}
				}
			}
		}

		return fileReadIndices
	}

	/**
	 * parses specific tool call formats, returns null if no acceptable format is found
	 */
	private parsePotentialToolCall(text: string): [string, string] | null {
		const match = text.match(/^\[([^\s]+) for '([^']+)'\] Result:$/)

		if (!match) {
			return null
		}

		return [match[1], match[2]]
	}

	/**
	 * file_read tool call always pastes the file, so this is always a hit
	 */
	private handleReadFileToolCall(i: number, filePath: string, fileReadIndices: Map<string, [number, string][]>) {
		const indices = fileReadIndices.get(filePath) || []
		indices.push([i, formatResponse.duplicateFileReadNotice()])
		fileReadIndices.set(filePath, indices)
	}

	/**
	 * write_to_file and replace_in_file tool output are handled similarly
	 */
	private handlePotentialFileChangeToolCalls(
		i: number,
		filePath: string,
		secondBlockText: string,
		fileReadIndices: Map<string, [number, string][]>,
	) {
		const pattern = new RegExp(`(<final_file_content path="[^"]*">)[\\s\\S]*?(</final_file_content>)`)

		// check if this exists in the text, it wont exist if the user rejects the file change for example
		if (pattern.test(secondBlockText)) {
			const replacementText = secondBlockText.replace(pattern, `$1 ${formatResponse.duplicateFileReadNotice()} $2`)
			const indices = fileReadIndices.get(filePath) || []
			indices.push([i, replacementText])
			fileReadIndices.set(filePath, indices)
		}
	}

	/**
	 * alter all occurrences of file read operations and track which messages were updated
	 * returns the outer index of messages we alter, to count number of changes
	 */
	private applyFileReadContextHistoryUpdates(
		fileReadIndices: Map<string, [number, string][]>,
		timestamp: number,
	): [boolean, Set<number>] {
		let didUpdate = false
		const updatedMessageIndices = new Set<number>() // track which messages we update on this round

		for (const indices of fileReadIndices.values()) {
			// Only process if there are multiple reads of the same file
			if (indices.length > 1) {
				// Process all but the last index, as we will keep that instance of the file read
				for (let i = 0; i < indices.length - 1; i++) {
					const messageIndex = indices[i][0]
					const messageString = indices[i][1] // what we will replace the string with

					let innerMap = this.contextHistoryUpdates.get(messageIndex)
					if (!innerMap) {
						innerMap = new Map<number, ContextUpdate[]>()
						this.contextHistoryUpdates.set(messageIndex, innerMap)
					}

					// block index for file reads from read_file, write_to_file, replace_in_file tools is 1
					const blockIndex = 1

					const updates = innerMap.get(blockIndex) || []

					updates.push([timestamp, "text", [messageString]])

					innerMap.set(blockIndex, updates)

					didUpdate = true
					updatedMessageIndices.add(messageIndex)
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
			// looping over the outer indicies of messages
			const message = apiMessages[i]

			if (!message.content) {
				continue
			}

			// `hasExistingAlterations` will also include the alterations we just made
			const hasExistingAlterations = this.contextHistoryUpdates.has(i)
			const hasNewAlterations = uniqueFileReadIndices.has(i)

			if (Array.isArray(message.content)) {
				for (let blockIndex = 0; blockIndex < message.content.length; blockIndex++) {
					// looping over inner indices of messages
					const block = message.content[blockIndex]

					if (block.type === "text" && block.text) {
						// true if we just altered it, or it was altered before
						if (hasExistingAlterations) {
							const innerMap = this.contextHistoryUpdates.get(i)
							const updates = innerMap?.get(blockIndex)

							if (updates && updates.length > 0) {
								// exists if we have an update for the message at this index
								const latestUpdate = updates[updates.length - 1]

								// if block was just altered, then calculate savings
								if (hasNewAlterations) {
									const originalTextLength = block.text.length
									const newTextLength = latestUpdate[2][0].length // replacement text
									totalCharactersSaved += originalTextLength - newTextLength

									totalCharCount += originalTextLength
								} else {
									totalCharCount += latestUpdate[2][0].length
								}
							} else {
								// reach here if there was one inner index with an update, but now we are at a different index, so updates is not defined
								totalCharCount += block.text.length
							}
						} else {
							// reach here if there's no alterations for this outer index
							totalCharCount += block.text.length
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
