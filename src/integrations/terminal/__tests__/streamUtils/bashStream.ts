// streamUtils/bashStream.ts
import { execSync } from "child_process"
import { CommandStream } from "./index"

/**
 * Creates a stream with real command output using Bash
 * @param command The bash command to execute
 * @returns An object containing the stream and exit code
 */
export function createBashCommandStream(command: string): CommandStream {
	let realOutput: string
	let exitCode: number

	try {
		// Execute the command and get the real output
		realOutput = execSync(command, {
			encoding: "utf8",
			maxBuffer: 100 * 1024 * 1024, // Increase buffer size to 100MB
			stdio: ["pipe", "pipe", "ignore"], // Redirect stderr to null
		})
		exitCode = 0 // Command succeeded
	} catch (error: any) {
		// Command failed - get output and exit code from error
		realOutput = error.stdout?.toString() || ""

		// Handle signal termination
		if (error.signal) {
			// Convert signal name to number using Node's constants
			const signals: Record<string, number> = {
				SIGTERM: 15,
				SIGSEGV: 11,
				// Add other signals as needed
			}
			const signalNum = signals[error.signal]
			if (signalNum !== undefined) {
				exitCode = 128 + signalNum // Signal exit codes are 128 + signal number
			} else {
				// Log error and default to 1 if signal not recognized
				console.log(`[DEBUG] Unrecognized signal '${error.signal}' from command '${command}'`)
				exitCode = 1
			}
		} else {
			exitCode = error.status || 1 // Use status if available, default to 1
		}
	}

	// Create an async iterator that yields the command output with proper markers
	// and realistic chunking (not guaranteed to split on newlines)
	const stream = {
		async *[Symbol.asyncIterator]() {
			// First yield the command start marker
			yield "\x1b]633;C\x07"

			// Yield the real output in potentially arbitrary chunks
			// This simulates how terminal data might be received in practice
			if (realOutput.length > 0) {
				// For a simple test like "echo a", we'll just yield the whole output
				// For more complex outputs, we could implement random chunking here
				yield realOutput
			}

			// Last yield the command end marker
			yield "\x1b]633;D\x07"
		},
	}

	return { stream, exitCode }
}
