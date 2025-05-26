import type { ClineMessage } from "@roo-code/types"

export const COMMAND_OUTPUT_STRING = "Output:"

/**
 * Combines sequences of command and command_output messages in an array of ClineMessages.
 *
 * This function processes an array of ClineMessages objects, looking for sequences
 * where a 'command' message is followed by one or more 'command_output' messages.
 * When such a sequence is found, it combines them into a single message, merging
 * their text contents.
 *
 * @param messages - An array of ClineMessage objects to process.
 * @returns A new array of ClineMessage objects with command sequences combined.
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
	const combinedCommands: ClineMessage[] = []

	// First pass: combine commands with their outputs.
	for (let i = 0; i < messages.length; i++) {
		if (messages[i].type === "ask" && messages[i].ask === "command") {
			let combinedText = messages[i].text || ""
			let j = i + 1
			let previous: { type: "ask" | "say"; text: string } | undefined

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
						combinedText += text
					}

					previous = { type, text }
				}

				j++
			}

			combinedCommands.push({ ...messages[i], text: combinedText })

			// Move to the index just before the next command or end of array.
			i = j - 1
		}
	}

	// console.log(`[combineCommandSequences] combinedCommands ->`, messages, combinedCommands)

	// Second pass: remove command_outputs and replace original commands with
	// combined ones.
	return messages
		.filter((msg) => !(msg.ask === "command_output" || msg.say === "command_output"))
		.map((msg) => {
			if (msg.type === "ask" && msg.ask === "command") {
				return combinedCommands.find((cmd) => cmd.ts === msg.ts) || msg
			}

			return msg
		})
}
