import { ClineMessage } from "./ExtensionMessage"

// Maximum length for command output in combined messages
const MAX_COMMAND_OUTPUT_LENGTH = 3000;

/**
 * Truncates command output to a reasonable size while preserving context
 * @param output The command output to truncate
 * @returns Truncated output with context preservation
 */
function truncateCommandOutput(output: string): string {
    if (output.length <= MAX_COMMAND_OUTPUT_LENGTH) {
        return output;
    }

    const lines = output.split('\n');
    
    // Always keep the first line as it often contains important context
    let result = lines[0] + '\n';
    
    // If we have multiple lines
    if (lines.length > 1) {
        // Calculate remaining space after first line
        const remainingSpace = MAX_COMMAND_OUTPUT_LENGTH - result.length - 50; // 50 chars for truncation message
        
        // Get last few lines that will fit in remaining space
        let lastLines = [];
        let currentLength = 0;
        
        for (let i = lines.length - 1; i > 0; i--) {
            const line = lines[i];
            if (currentLength + line.length + 1 <= remainingSpace) { // +1 for newline
                lastLines.unshift(line);
                currentLength += line.length + 1;
            } else {
                break;
            }
        }

        if (lastLines.length > 0) {
            result += '... [output truncated] ...\n' + lastLines.join('\n');
        } else {
            result += '... [output truncated] ...';
        }
    }

    return result;
}

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
        if (messages[i].type === "ask" && messages[i].ask === "command") {
            let combinedText = messages[i].text || ""
            let outputParts: string[] = []
            let didAddOutput = false
            let j = i + 1

            while (j < messages.length) {
                if (messages[j].type === "ask" && messages[j].ask === "command") {
                    // Stop if we encounter the next command
                    break
                }
                if (messages[j].ask === "command_output" || messages[j].say === "command_output") {
                    // handle cases where we receive empty command_output (ie when extension is relinquishing control over exit command button)
                    const output = messages[j].text || ""
                    if (output.length > 0) {
                        outputParts.push(output)
                    }
                }
                j++
            }

            if (outputParts.length > 0) {
                // Combine all output parts and truncate the combined result
                const fullOutput = outputParts.join('\n')
                const truncatedOutput = truncateCommandOutput(fullOutput)
                combinedText += `\n${COMMAND_OUTPUT_STRING}\n${truncatedOutput}`
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
            if (msg.type === "ask" && msg.ask === "command") {
                const combinedCommand = combinedCommands.find((cmd) => cmd.ts === msg.ts)
                return combinedCommand || msg
            }
            return msg
        })
}

export const COMMAND_OUTPUT_STRING = "Output:"
