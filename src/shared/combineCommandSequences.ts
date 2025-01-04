import { ClineMessage } from "./ExtensionMessage"

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

	// First pass: combine commands with their outputs
	for (let i = 0; i < messages.length; i++) {
		if (messages[i].type === "ask" && (messages[i].ask === "command" || messages[i].say === "command")) {
			let combinedText = messages[i].text || ""
			let didAddOutput = false
			let j = i + 1

			while (j < messages.length) {
				if (messages[j].type === "ask" && (messages[j].ask === "command" || messages[j].say === "command")) {
					// Stop if we encounter the next command
					break
				}
				if (messages[j].ask === "command_output" || messages[j].say === "command_output") {
					if (!didAddOutput) {
						// Add a newline before the first output
						combinedText += `\n${COMMAND_OUTPUT_STRING}`
						didAddOutput = true
					}
					// handle cases where we receive empty command_output (ie when extension is relinquishing control over exit command button)
					const output = messages[j].text || ""
					if (output.length > 0) {
						combinedText += "\n" + output
					}
				}
				j++
			}

			combinedCommands.push({
				...messages[i],
				text: combinedText,
			})

			i = j - 1 // Move to the index just before the next command or end of array
		}
	}

	// Second pass: remove command_outputs and replace original commands with combined ones
	return messages
		.filter((msg) => !(msg.ask === "command_output" || msg.say === "command_output"))
		.map((msg) => {
			if (msg.type === "ask" && (msg.ask === "command" || msg.say === "command")) {
				const combinedCommand = combinedCommands.find((cmd) => cmd.ts === msg.ts)
				return combinedCommand || msg
			}
			return msg
		})
}
export const COMMAND_OUTPUT_STRING = "Output:"
export const COMMAND_REQ_APP_STRING = "REQ_APP"
