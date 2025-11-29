import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { TerminalProcess } from "./TerminalProcess"

// 10 minute hard timeout for detached processes
const HARD_TIMEOUT_MS = 10 * 60 * 1000

export interface DetachedProcess {
	id: string
	command: string
	startTime: number
	status: "running" | "completed" | "error" | "timed_out"
	logFilePath: string
	lineCount: number
	exitCode?: number
}

export class DetachedProcessManager {
	private processes: Map<string, DetachedProcess> = new Map()
	private logStreams: Map<string, fs.WriteStream> = new Map()
	private timeouts: Map<string, NodeJS.Timeout> = new Map()

	/**
	 * Add a process to be tracked as detached.
	 * Creates a log file and pipes output to it.
	 * Sets up a 10-minute hard timeout to prevent zombie processes.
	 */
	addProcess(process: TerminalProcess, command: string): DetachedProcess {
		console.log("[DEBUG DetachedProcessManager.addProcess] Called with command:", command)
		const id = `detached-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
		const logFilePath = path.join(os.tmpdir(), `cline-${id}.log`)
		console.log("[DEBUG DetachedProcessManager.addProcess] Created id:", id, "logFilePath:", logFilePath)

		const detached: DetachedProcess = {
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
			detached.lineCount++
			logStream.write(line + "\n")
		})

		// Set up 10-minute hard timeout to prevent zombie processes
		const timeoutId = setTimeout(() => {
			if (detached.status === "running") {
				console.log(`[DetachedProcessManager] Hard timeout reached for process ${id}, terminating...`)
				detached.status = "timed_out"
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
			detached.status = "completed"
			logStream.end()
		})

		// Listen for errors - clear timeout
		process.on("error", (error: Error) => {
			const timeout = this.timeouts.get(id)
			if (timeout) {
				clearTimeout(timeout)
				this.timeouts.delete(id)
			}
			detached.status = "error"
			// Try to extract exit code from error message if available
			const exitCodeMatch = error.message.match(/exit code (\d+)/)
			if (exitCodeMatch) {
				detached.exitCode = parseInt(exitCodeMatch[1], 10)
			}
			logStream.end()
		})

		this.processes.set(id, detached)
		return detached
	}

	/**
	 * Get a specific detached process by ID.
	 */
	getProcess(id: string): DetachedProcess | undefined {
		return this.processes.get(id)
	}

	/**
	 * Get all detached processes.
	 */
	getAllProcesses(): DetachedProcess[] {
		return Array.from(this.processes.values())
	}

	/**
	 * Get a summary string for getEnvironmentDetails().
	 */
	getSummary(): string {
		const running = this.getAllProcesses().filter((p) => p.status === "running")
		if (running.length === 0) {
			return ""
		}

		const lines = [`# Detached Processes (${running.length} running)`]
		for (const p of running) {
			const duration = Math.round((Date.now() - p.startTime) / 1000 / 60)
			lines.push(`- ${p.command} (running ${duration}m, ${p.lineCount} lines, log: ${p.logFilePath})`)
		}
		return lines.join("\n")
	}

	/**
	 * Clean up all resources (timeouts, log streams).
	 * Called when the Task is disposed.
	 */
	dispose(): void {
		// Clear all timeouts
		for (const [id, timeout] of this.timeouts) {
			clearTimeout(timeout)
		}
		this.timeouts.clear()

		// Close all log streams
		for (const [id, logStream] of this.logStreams) {
			try {
				logStream.end()
			} catch (error) {
				console.error(`[DetachedProcessManager] Error closing log stream for ${id}:`, error)
			}
		}
		this.logStreams.clear()

		// Clear process tracking
		this.processes.clear()
	}
}
