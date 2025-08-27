import type { ClineMessage } from "@roo-code/types"

import { safeJsonParse } from "./safeJsonParse"

export const COMMAND_OUTPUT_STRING = "Output:"

/**
 * Combines sequences of command and command_output messages in an array of ClineMessages.
 * Also combines sequences of use_mcp_server and mcp_server_response messages.
 *
 * This function processes an array of ClineMessages objects, looking for sequences
 * where a 'command' message is followed by one or more 'command_output' messages,
 * or where a 'use_mcp_server' message is followed by one or more 'mcp_server_response' messages.
 * When such a sequence is found, it combines them into a single message, merging
 * their text contents.
 *
 * @param messages - An array of ClineMessage objects to process.
 * @returns A new array of ClineMessage objects with command and MCP sequences combined.
 *
 * @example
 * const messages: ClineMessage[] = [
 *   { type: 'ask', ask: 'command', text: 'ls', ts: 1625097600000 },
 *   { type: 'ask', ask: 'command_output', text: 'file1.txt', ts: 1625097601000 },
 *   { type: 'ask', ask: 'command_output', text: 'file2.txt', ts: 1625097602000 }
 * ];
 * const result = simpleCombineCommandSequences(messages);
 * // Result: [{ type: 'ask', ask: 'command', text: 'ls\nfile1.txt\nfile2.txt', ts: 1625097600000 }]
 */
export function combineCommandSequences(messages: ClineMessage[]): ClineMessage[] {
	const combinedMessages = new Map<number, ClineMessage>()
	const processedIndices = new Set<number>()

	// Single pass through all messages
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]

		// Handle MCP server requests
		if (msg.type === "ask" && msg.ask === "use_mcp_server") {
			// Look ahead for MCP responses
			let responses: string[] = []
			let j = i + 1

			while (j < messages.length) {
				if (messages[j].say === "mcp_server_response") {
					responses.push(messages[j].text || "")
					processedIndices.add(j)
					j++
				} else if (messages[j].type === "ask" && messages[j].ask === "use_mcp_server") {
					// Stop if we encounter another MCP request
					break
				} else {
					j++
				}
			}

			if (responses.length > 0) {
				// Parse the JSON from the message text
				const jsonObj = safeJsonParse<any>(msg.text || "{}", {})

				// Add the response to the JSON object
				jsonObj.response = responses.join("\n")

				// Stringify the updated JSON object
				const combinedText = JSON.stringify(jsonObj)

				combinedMessages.set(msg.ts, { ...msg, text: combinedText })
			} else {
				// If there's no response, just keep the original message
				combinedMessages.set(msg.ts, { ...msg })
			}
		}
		// Handle command sequences
		else if (msg.type === "ask" && msg.ask === "command") {
			let combinedText = msg.text || ""
			let j = i + 1
			let previous: { type: "ask" | "say"; text: string } | undefined
			let lastProcessedIndex = i

			while (j < messages.length) {
				const { type, ask, say, text = "" } = messages[j]

				if (type === "ask" && ask === "command") {
					break // Stop if we encounter the next command.
				}

				if (ask === "command_output" || say === "command_output") {
					if (!previous) {
						combinedText += `\n${COMMAND_OUTPUT_STRING}`
					}

					const isDuplicate = previous && previous.type !== type && previous.text === text

					if (text.length > 0 && !isDuplicate) {
						// Add a newline before adding the text if there's already content
						if (
							previous &&
							combinedText.length >
								combinedText.indexOf(COMMAND_OUTPUT_STRING) + COMMAND_OUTPUT_STRING.length
						) {
							combinedText += "\n"
						}
						combinedText += text
					}

					previous = { type, text }
					processedIndices.add(j)
					lastProcessedIndex = j
				}

				j++
			}

			combinedMessages.set(msg.ts, { ...msg, text: combinedText })

			// Only skip ahead if we actually processed command outputs
			if (lastProcessedIndex > i) {
				i = lastProcessedIndex
			}
		}
	}

	// Build final result: filter out processed messages and use combined versions
	const result: ClineMessage[] = []
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]

		// Skip messages that were processed as outputs/responses
		if (processedIndices.has(i)) {
			continue
		}

		// Skip command_output and mcp_server_response messages
		if (msg.ask === "command_output" || msg.say === "command_output" || msg.say === "mcp_server_response") {
			continue
		}

		// Use combined version if available
		if (combinedMessages.has(msg.ts)) {
			result.push(combinedMessages.get(msg.ts)!)
		} else {
			result.push(msg)
		}
	}

	return result
}
