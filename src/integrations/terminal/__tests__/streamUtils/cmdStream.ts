// streamUtils/cmdStream.ts
import { execSync } from "child_process"
import { CommandStream } from "./index"

/**
 * Creates a stream with real command output using CMD
 * @param command The CMD command to execute
 * @returns An object containing the stream and exit code
 */
export function createCmdCommandStream(command: string): CommandStream {
	let realOutput: string
	let exitCode: number

	try {
		// Execute the CMD command directly
		// Use cmd.exe explicitly to ensure we're using CMD
		const shellCommand = `cmd.exe /c ${command}`

		realOutput = execSync(shellCommand, {
			encoding: "utf8",
			maxBuffer: 100 * 1024 * 1024,
			stdio: ["pipe", "pipe", "ignore"], // Redirect stderr to null
		})
		exitCode = 0 // Command succeeded
	} catch (error: any) {
		// Command failed - get output and exit code from error
		realOutput = error.stdout?.toString() || ""
		exitCode = error.status || 1
	}

	// Create an async iterator for the stream
	const stream = {
		async *[Symbol.asyncIterator]() {
			// Command start marker
			yield "\x1b]633;C\x07"

			// Yield the real output (keep Windows line endings for CMD)
			if (realOutput.length > 0) {
				yield realOutput
			}

			// Command end marker
			yield "\x1b]633;D\x07"
		},
	}

	return { stream, exitCode }
}
