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

// string used for text blocks, string[] used for image blocks
export type MessageContent = string | string[]

// Type for a single context update
type ContextUpdate = [number, string, MessageContent] // [timestamp, updateType, update]

// Type for the serialized format of our nested maps
type SerializedContextHistory = Array<[
    number, // messageIndex
    Array<[
        number, // blockIndex
        ContextUpdate[] // updates array
    ]>
]>

export class ContextManager {
	// mapping from the apiMessages outer index to the inner message index to a list of actual changes, ordered by timestamp
	// timestamp is required in order to support full checkpointing, where the changes we apply need to be able to be undone when
	// moving to an earlier conversation history checkpoint - this ordering intuitively allows for binary search on truncation

	// format:  {outerIndex => {innerIndex => [[timestamp, updateType, update], ...]}}
	// example: { 1 => { 0 => [[<timestamp>, "text", "[NOTE] Some previous conversation history with the user has been removed ..."], ...] } }
	// the above example would be how we update the first assistant message to indicate we truncated text
	private contextHistoryUpdates: Map<number, Map<number, [number, string, MessageContent][]>>

    constructor() {
		this.contextHistoryUpdates = new Map() // defaults to having no keys, so no alterations if file read incorrectly
    }

	/**
	 * public function for loading contextHistory from memory, if it exists
	 * loading can also be done in each call
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
				const data = await fs.readFile(filePath, 'utf8')
				const serializedUpdates = JSON.parse(data) as SerializedContextHistory
				
				return new Map(
					serializedUpdates.map(([messageIndex, innerMapArray]) => [
						messageIndex,
						new Map(innerMapArray)
					])
				)
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
			const serializedUpdates: SerializedContextHistory = Array.from(
				this.contextHistoryUpdates.entries()
			).map(([messageIndex, innerMap]) => [
				messageIndex,
				Array.from(innerMap.entries())
			])
			
			await fs.writeFile(
				path.join(taskDirectory, GlobalFileNames.contextHistory),
				JSON.stringify(serializedUpdates),
				'utf8'
			)
		} catch (error) {
			// in the off chance this fails, we don't want to stop the task
			console.error("Failed to save context history:", error)
		}
	}

	/**
	 * primary entry point for getting up to date contexxt & truncating when required
	 */
	async getNewContextMessagesAndMetadata(
		apiConversationHistory: Anthropic.Messages.MessageParam[],
		clineMessages: ClineMessage[],
		api: ApiHandler,
		conversationHistoryDeletedRange: [number, number] | undefined,
		previousApiReqIndex: number,
		taskDirectory: string
	) {
		let updatedConversationHistoryDeletedRange = false

		// optionally could always load the contextHistory from disk here

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

					// update the first assistant message if required for narrative integrity
					this.applyStandardContextTruncationNoticeChangeToConversation(timestamp)

					await this.saveContextHistory(taskDirectory) // could add a check here to determine whether we have changed anything, prior to saving

					// NOTE: it's okay that we overwriteConversationHistory in resume task since we're only ever removing the last user message and not anything in the middle which would affect this range
					conversationHistoryDeletedRange = this.getNextTruncationRange(
						apiConversationHistory,
						conversationHistoryDeletedRange,
						keep
					)

					updatedConversationHistoryDeletedRange = true
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

	public getNextTruncationRange(
		apiMessages: Anthropic.Messages.MessageParam[],
		currentDeletedRange: [number, number] | undefined,
		keep: "half" | "quarter"
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

		// Make sure that the last message being removed is a assistant message, so the next message after the initial user-assistant pair is an assistant message. This preservers the user-assistant-user-assistant structure.
		// NOTE: anthropic format messages are always user-assistant-user-assistant, while openai format messages can have multiple user messages in a row (we use anthropic format throughout cline)
		if (apiMessages[rangeEndIndex].role !== "assistant") {
			rangeEndIndex -= 1
		}

		// this is an inclusive range that will be removed from the conversation history
		return [rangeStartIndex, rangeEndIndex]
	}

	public getTruncatedMessages(
		messages: Anthropic.Messages.MessageParam[],
		deletedRange: [number, number] | undefined,
	): Anthropic.Messages.MessageParam[] {
		return this.getAndAlterTruncatedMessages(messages, deletedRange)
	}

    private getAndAlterTruncatedMessages(
        messages: Anthropic.Messages.MessageParam[],
        deletedRange: [number, number] | undefined,
    ): Anthropic.Messages.MessageParam[] {
        // here we need to apply the changes from the file reads / other changes - this needs to be done by looping over the deleted range
        ///// or doing nothing if its undefined, this should be another function call

        if (messages.length <= 1) return messages

		const updatedMessages = this.applyContextHistoryUpdates(messages, deletedRange ? deletedRange[1] + 1 : 2)

		// OLD NOTE: if you try to console log these, don't forget that logging a reference to an array may not provide the same result as logging a slice() snapshot of that array at that exact moment. The following DOES in fact include the latest assistant message.
		return updatedMessages
    }

	/**
	 * applies the correct alterations based on changes set in this.contextHistoryUpdates
	 */
    private applyContextHistoryUpdates(
        messages: Anthropic.Messages.MessageParam[],
        startFromIndex: number,
    ): Anthropic.Messages.MessageParam[] {
		// runtime is linear in length of user messages, if expecting a limited number of alteration, could be more optimal to loop over changes instead

        const firstChunk = messages.slice(0, 2)  // get first user-assistant pair
        const secondChunk = messages.slice(startFromIndex) // get remaining messages within context
        const messagesToUpdate = [...firstChunk, ...secondChunk]

		// we need the mapping from the local indices in messagesToUpdate to the global array of updates in this.contextHistoryUpdates
        const originalIndices = [...Array(2).keys(), ...Array(secondChunk.length).fill(0).map((_, i) => i + startFromIndex)]
        
        for (let arrayIndex = 0; arrayIndex < messagesToUpdate.length; arrayIndex++) {
            const messageIndex = originalIndices[arrayIndex]
            
            const innerMap = this.contextHistoryUpdates.get(messageIndex)
            if (!innerMap) continue

			// because we are altering this, we need a deep copy
			messagesToUpdate[arrayIndex] = cloneDeep(messagesToUpdate[arrayIndex])
            
            // For each block index and its changes array in the inner map
            for (const [blockIndex, changes] of innerMap) {
                // apply the latest change among n changes - [timestamp, updateType, update]
                const latestChange = changes[changes.length - 1]
                
                if (latestChange[1] === "text") { // only altering text for now
                    const message = messagesToUpdate[arrayIndex]
                    
                    if (Array.isArray(message.content)) {
                        const block = message.content[blockIndex]
                        if (block && block.type === "text") {
                            block.text = latestChange[2]
                        }
                    }
                }
            }
        }
        
        return messagesToUpdate
    }

	/**
	 * if there is any truncation, and there is no other alteration already set, alter the assistant message to indicate this occured
	 */
    private applyStandardContextTruncationNoticeChangeToConversation(timestamp: number) {
        if (!this.contextHistoryUpdates.has(1)) { // first assistant message always at index 1
            const innerMap = new Map<number, [number, string, MessageContent][]>()
            innerMap.set(0, [[timestamp, "text", formatResponse.contextTruncationNotice()]])
            this.contextHistoryUpdates.set(1, innerMap)
        }
    }

	/**
	 * Helper function that removes all context history updates with timestamps greater than the provided timestamp
	 * Mutates the input map directly.
	 * @param contextHistory The context history map to modify
	 * @param timestamp The cutoff timestamp
	 */
	private truncateContextHistoryAtTimestamp(
		contextHistory: Map<number, Map<number, [number, string, MessageContent][]>>,
		timestamp: number
	): void {
		// Iterate through each message index
		for (const [messageIndex, innerMap] of contextHistory) {
			// For each block index
			for (const [blockIndex, updates] of innerMap) {
				// Since updates are ordered by timestamp, find cutoff point
				// by iterating from right to left
				let cutoffIndex = updates.length - 1
				while (cutoffIndex >= 0 && updates[cutoffIndex][0] > timestamp) {
					cutoffIndex--
				}
				
				// If we found updates to remove
				if (cutoffIndex < updates.length - 1) {
					// Modify the array in place to keep only updates up to cutoffIndex
					updates.length = cutoffIndex + 1
				}
			}
		}
	}

	/**
	 * removes all context history updates that occurred after the specified timestamp and saves to disk
	 */
	public async truncateContextHistory(timestamp: number, taskDirectory: string): Promise<void> {
		this.truncateContextHistoryAtTimestamp(this.contextHistoryUpdates, timestamp)
		
		// Save the modified history to disk
		await this.saveContextHistory(taskDirectory)
	}
}
