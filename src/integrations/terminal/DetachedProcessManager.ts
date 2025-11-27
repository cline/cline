import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { TerminalProcess } from "./TerminalProcess"

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

	/**
	 * Add a process to be tracked as detached.
	 * Creates a log file and pipes output to it.
	 */
	addProcess(process: TerminalProcess, command: string): DetachedProcess {
		const id = `detached-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
		const logFilePath = path.join(os.tmpdir(), `cline-${id}.log`)

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

		// Listen for completion
		process.on("completed", () => {
			detached.status = "completed"
			logStream.end()
		})

		// Listen for errors
		process.on("error", (error: Error) => {
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
}
