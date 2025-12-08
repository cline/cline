import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { TerminalProcessResultPromise } from "../types"

/**
 * BackgroundCommandTracker - Standalone Mode Only
 *
 * Tracks commands that continue running after the user clicks "Proceed While Running".
 * This is only used in standalone/CLI mode (backgroundExec execution mode).
 *
 * Key responsibilities:
 * - Log command output to temp files for later retrieval
 * - Track command status (running, completed, error, timed_out)
 * - Implement 10-minute hard timeout to prevent zombie processes
 * - Provide summary for environment details
 *
 * NOT used in VSCode extension mode - only standalone/CLI.
 *
 * @see README.md in this directory for architecture overview
 */

// 10 minute hard timeout for background commands
const HARD_TIMEOUT_MS = 10 * 60 * 1000

/**
 * Represents a command that is running in the background after the user
 * clicked "Proceed While Running".
 */
export interface BackgroundCommand {
	id: string
	command: string
	startTime: number
	status: "running" | "completed" | "error" | "timed_out"
	logFilePath: string
	lineCount: number
	exitCode?: number
}

export class BackgroundCommandTracker {
	private commands: Map<string, BackgroundCommand> = new Map()
	private logStreams: Map<string, fs.WriteStream> = new Map()
	private timeouts: Map<string, NodeJS.Timeout> = new Map()

	/**
	 * Track a command that will continue running in the background.
	 * Creates a log file and pipes output to it.
	 * Sets up a 10-minute hard timeout to prevent zombie processes.
	 */
	trackCommand(
		process: TerminalProcessResultPromise & {
			terminate?: () => void
		},
		command: string,
	): BackgroundCommand {
		console.log("[DEBUG BackgroundCommandTracker.trackCommand] Called with command:", command)
		const id = `background-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
		const logFilePath = path.join(os.tmpdir(), `cline-${id}.log`)
		console.log("[DEBUG BackgroundCommandTracker.trackCommand] Created id:", id, "logFilePath:", logFilePath)

		const backgroundCommand: BackgroundCommand = {
			id,
			command,
			startTime: Date.now(),
			status: "running",
			logFilePath,
			lineCount: 0,
		}

		// Create write stream for log file
		const logStream = fs.createWriteStream(logFilePath, { flags: "a" })
		this.logStreams.set(id, logStream)

		// Pipe process output to log file
		process.on("line", (line: string) => {
			backgroundCommand.lineCount++
			logStream.write(line + "\n")
		})

		// Set up 10-minute hard timeout to prevent zombie processes
		const timeoutId = setTimeout(() => {
			if (backgroundCommand.status === "running") {
				console.log(`[BackgroundCommandTracker] Hard timeout reached for command ${id}, terminating...`)
				backgroundCommand.status = "timed_out"
				logStream.write("\n[TIMEOUT] Process killed after 10 minutes\n")
				logStream.end()

				// Terminate the process if it has a terminate method (StandaloneTerminalProcess / enhanced terminal)
				// Regular TerminalProcess (VSCode terminal) doesn't have terminate(), so we check
				if (process && typeof (process as any).terminate === "function") {
					;(process as any).terminate()
				}
			}
		}, HARD_TIMEOUT_MS)
		this.timeouts.set(id, timeoutId)

		// Listen for completion - clear timeout
		process.on("completed", () => {
			const timeout = this.timeouts.get(id)
			if (timeout) {
				clearTimeout(timeout)
				this.timeouts.delete(id)
			}
			backgroundCommand.status = "completed"
			logStream.end()
		})

		// Listen for errors - clear timeout
		process.on("error", (error: Error) => {
			const timeout = this.timeouts.get(id)
			if (timeout) {
				clearTimeout(timeout)
				this.timeouts.delete(id)
			}
			backgroundCommand.status = "error"
			// Try to extract exit code from error message if available
			const exitCodeMatch = error.message.match(/exit code (\d+)/)
			if (exitCodeMatch) {
				backgroundCommand.exitCode = parseInt(exitCodeMatch[1], 10)
			}
			logStream.end()
		})

		this.commands.set(id, backgroundCommand)
		return backgroundCommand
	}

	/**
	 * Get a specific background command by ID.
	 */
	getCommand(id: string): BackgroundCommand | undefined {
		return this.commands.get(id)
	}

	/**
	 * Get all tracked background commands.
	 */
	getAllCommands(): BackgroundCommand[] {
		return Array.from(this.commands.values())
	}

	/**
	 * Get a summary string for getEnvironmentDetails().
	 */
	getSummary(): string {
		const running = this.getAllCommands().filter((c) => c.status === "running")
		if (running.length === 0) {
			return ""
		}

		const lines = [`# Background Commands (${running.length} running)`]
		for (const c of running) {
			const duration = Math.round((Date.now() - c.startTime) / 1000 / 60)
			lines.push(`- ${c.command} (running ${duration}m, ${c.lineCount} lines, log: ${c.logFilePath})`)
		}
		return lines.join("\n")
	}

	/**
	 * Clean up all resources (timeouts, log streams).
	 * Called when the Task is disposed.
	 */
	dispose(): void {
		// Clear all timeouts
		for (const [_id, timeout] of this.timeouts) {
			clearTimeout(timeout)
		}
		this.timeouts.clear()

		// Close all log streams
		for (const [id, logStream] of this.logStreams) {
			try {
				logStream.end()
			} catch (error) {
				console.error(`[BackgroundCommandTracker] Error closing log stream for ${id}:`, error)
			}
		}
		this.logStreams.clear()

		// Clear command tracking
		this.commands.clear()
	}
}
