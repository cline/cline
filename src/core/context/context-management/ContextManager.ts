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

						// we later check how many chars we trim to determine if we should still truncate history
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
					const processedFirstUserMessage = formatResponse.processFirstUserMessageForTruncation(firstUserMessage)

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
	): [Map<string, [number, number, string, string][]>, Map<number, string[]>] {
		// fileReadIndices: { fileName => [outerIndex, EditType, searchText, replaceText] }
		// messageFilePaths: { outerIndex => [fileRead1, fileRead2, ..] }
		// searchText in fileReadIndices is only required for file mention file-reads since there can be more than one file in the text
		// searchText will be the empty string "" in the case that it's not required, for non-file mentions
		// messageFilePaths is only used for file mentions as there can be multiple files read in the same text chunk

		// for all text blocks per file, has info for updating the block
		const fileReadIndices = new Map<string, [number, number, string, string][]>()

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

						const blockIndex = 1 // file mention blocks assumed to be at index 1
						const blockUpdates = innerMap.get(blockIndex)

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
				if (firstBlock.type === "text") {
					const matchTup = this.parsePotentialToolCall(firstBlock.text)
					let foundNormalFileRead = false
					if (matchTup) {
						if (matchTup[0] === "read_file") {
							this.handleReadFileToolCall(i, matchTup[1], fileReadIndices)
							foundNormalFileRead = true
						} else if (matchTup[0] === "replace_in_file" || matchTup[0] === "write_to_file") {
							if (message.content.length > 1) {
								const secondBlock = message.content[1]
								if (secondBlock.type === "text") {
									this.handlePotentialFileChangeToolCalls(i, matchTup[1], secondBlock.text, fileReadIndices)
									foundNormalFileRead = true
								}
							}
						}
					}

					// file mentions can happen in most other user message blocks
					if (!foundNormalFileRead) {
						if (message.content.length > 1) {
							const secondBlock = message.content[1]
							if (secondBlock.type === "text") {
								const [hasFileRead, filePaths] = this.handlePotentialFileMentionCalls(
									i,
									secondBlock.text,
									fileReadIndices,
									thisExistingFileReads, // file reads we've already replaced in this text in the latest version of this updated text
								)
								if (hasFileRead) {
									messageFilePaths.set(i, filePaths) // all file paths in this string
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
		secondBlockText: string,
		fileReadIndices: Map<string, [number, number, string, string][]>,
		thisExistingFileReads: string[],
	): [boolean, string[]] {
		const pattern = /<file_content path="([^"]*)">([\s\S]*?)<\/file_content>/g

		let foundMatch = false
		const filePaths: string[] = []

		for (const match of secondBlockText.matchAll(pattern)) {
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
				indices.push([i, EditType.FILE_MENTION, entireMatch, replacementText])
				fileReadIndices.set(filePath, indices)
			}
		}

		return [foundMatch, filePaths]
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
	private handleReadFileToolCall(
		i: number,
		filePath: string,
		fileReadIndices: Map<string, [number, number, string, string][]>,
	) {
		const indices = fileReadIndices.get(filePath) || []
		indices.push([i, EditType.READ_FILE_TOOL, "", formatResponse.duplicateFileReadNotice()])
		fileReadIndices.set(filePath, indices)
	}

	/**
	 * write_to_file and replace_in_file tool output are handled similarly
	 */
	private handlePotentialFileChangeToolCalls(
		i: number,
		filePath: string,
		secondBlockText: string,
		fileReadIndices: Map<string, [number, number, string, string][]>,
	) {
		const pattern = /(<final_file_content path="[^"]*">)[\s\S]*?(<\/final_file_content>)/

		// check if this exists in the text, it won't exist if the user rejects the file change for example
		if (pattern.test(secondBlockText)) {
			const replacementText = secondBlockText.replace(pattern, `$1 ${formatResponse.duplicateFileReadNotice()} $2`)
			const indices = fileReadIndices.get(filePath) || []
			indices.push([i, EditType.ALTER_FILE_TOOL, "", replacementText])
			fileReadIndices.set(filePath, indices)
		}
	}

	/**
	 * alter all occurrences of file read operations and track which messages were updated
	 * returns the outer index of messages we alter, to count number of changes
	 */
	private applyFileReadContextHistoryUpdates(
		fileReadIndices: Map<string, [number, number, string, string][]>,
		messageFilePaths: Map<number, string[]>,
		apiMessages: Anthropic.Messages.MessageParam[],
		timestamp: number,
	): [boolean, Set<number>] {
		let didUpdate = false
		const updatedMessageIndices = new Set<number>() // track which messages we update on this round
		const fileMentionUpdates = new Map<number, [string, string[]]>()

		for (const [filePath, indices] of fileReadIndices.entries()) {
			// Only process if there are multiple reads of the same file, else we will want to keep the latest read of the file
			if (indices.length > 1) {
				// Process all but the last index, as we will keep that instance of the file read
				for (let i = 0; i < indices.length - 1; i++) {
					const messageIndex = indices[i][0]
					const messageType = indices[i][1] // EditType value
					const searchText = indices[i][2] // search text (for file mentions, else empty string)
					const messageString = indices[i][3] // what we will replace the string with

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
								const blockUpdates = innerTuple[1].get(1) // assumed index=1 for file mention filereads
								if (blockUpdates && blockUpdates.length > 0) {
									baseText = blockUpdates[blockUpdates.length - 1][2][0] // index 0 of MessageContent
									prevFilesReplaced = blockUpdates[blockUpdates.length - 1][3][0] // previously overwritten file reads in this text
								}
							}

							// can assume that this content will exist, otherwise it would not have been in fileReadIndices
							const messageContent = apiMessages[messageIndex]?.content
							if (!baseText && Array.isArray(messageContent) && messageContent.length > 1) {
								const contentBlock = messageContent[1] // assume index=1 for all text to replace for file mention filereads
								if (contentBlock.type === "text") {
									baseText = contentBlock.text
								}
							}

							// prevFilesReplaced keeps track of the previous file reads we've replace in this string, empty array if none
							fileMentionUpdates.set(messageIndex, [baseText, prevFilesReplaced])
						}

						// Replace searchText with messageString for all file reads we need to replace in this text
						if (searchText) {
							const currentTuple = fileMentionUpdates.get(messageIndex) || ["", []]
							if (currentTuple[0]) {
								// safety check
								// replace this text chunk
								const updatedText = currentTuple[0].replace(searchText, messageString)

								// add the newly added filePath read
								const updatedFileReads = currentTuple[1]
								updatedFileReads.push(filePath)

								fileMentionUpdates.set(messageIndex, [updatedText, updatedFileReads])
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

						// block index for file reads from read_file, write_to_file, replace_in_file tools is 1
						const blockIndex = 1

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
		for (const [messageIndex, [updatedText, filePathsUpdated]] of fileMentionUpdates.entries()) {
			const innerTuple = this.contextHistoryUpdates.get(messageIndex)
			let innerMap: Map<number, ContextUpdate[]>

			if (!innerTuple) {
				innerMap = new Map<number, ContextUpdate[]>()
				this.contextHistoryUpdates.set(messageIndex, [EditType.FILE_MENTION, innerMap])
			} else {
				innerMap = innerTuple[1]
			}

			const blockIndex = 1 // we only consider the block index of 1 for file mentions
			const updates = innerMap.get(blockIndex) || []

			// filePathsUpdated includes changes done previously to this timestamp, and right now
			if (messageFilePaths.has(messageIndex)) {
				const allFileReads = messageFilePaths.get(messageIndex)
				if (allFileReads) {
					// safety check
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

					if (block.type === "text" && block.text) {
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
										originalTextLength = block.text.length
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
								totalCharCount += block.text.length
							}
						} else {
							// reach here if there's no alterations for this outer index, meaning each inner index won't have any changes either
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
