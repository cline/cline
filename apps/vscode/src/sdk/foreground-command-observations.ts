import { closeSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync } from "node:fs"
import path from "node:path"
import { MAX_COMMAND_OUTPUT_CHARS } from "@cline/core"
import {
	type DetachedCommandOutcome,
	DetachedCommandOutcomeSchema,
	detachedCommandBackgroundStatus,
	formatDetachedCompletionNote,
} from "@cline/shared"
import { resolveSessionDataDir } from "@cline/shared/storage"
import { z } from "zod"
import { COMMAND_OUTPUT_STRING } from "@/shared/combineCommandSequences"
import type { ClineMessage } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { atomicWriteFileSync } from "@/shared/storage/ClineFileStorage"

const RecordSchema = z.object({
	version: z.literal(1),
	sessionId: z.string().min(1),
	toolCallId: z.string().min(1),
	executionId: z.string().min(1),
	logPath: z.string().min(1),
	output: z.string(),
	state: z.enum(["observing", "completed", "lost"]),
	outcome: z.unknown().optional(),
})

type CommandRecord = Omit<z.infer<typeof RecordSchema>, "state" | "outcome"> &
	({ state: "observing" } | { state: "lost" } | { state: "completed"; outcome: DetachedCommandOutcome })
type OwnedObservation = { record: CommandRecord; disconnect: () => void }

export interface ForegroundCommandObservation {
	complete(outcome: DetachedCommandOutcome | undefined, output: string): void
}

/**
 * Records terminal observations, not OS processes. Only this owner's live
 * observation can prove a command is running; an unfinished record read by a
 * replacement owner is indeterminate. Shell PIDs never establish command state.
 */
export class ForegroundCommandObservations {
	private readonly owned = new Map<string, OwnedObservation>()
	private disposed = false

	private readonly sessionDataDir: string
	constructor(private readonly options: { sessionDataDir?: string; onChanged?: () => void } = {}) {
		this.sessionDataDir = options.sessionDataDir ?? resolveSessionDataDir()
	}

	private directory(sessionId: string): string {
		if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error("Invalid foreground observation session ID")
		return path.join(this.sessionDataDir, sessionId, "foreground-commands")
	}

	private persist(record: CommandRecord): boolean {
		try {
			// Completion must not recreate a session deleted while its command ran.
			atomicWriteFileSync(
				path.join(this.directory(record.sessionId), `${record.executionId}.json`),
				JSON.stringify(record),
				0o600,
			)
			return true
		} catch (error) {
			Logger.warn("[ForegroundCommandObservations] Could not persist observation", error)
			return false
		}
	}

	observe(
		input: { sessionId: string; toolCallId: string; executionId: string; logPath: string; output: string },
		disconnect: () => void,
	): ForegroundCommandObservation {
		if (this.disposed) throw new Error("Foreground command observations disposed")
		const directory = this.directory(input.sessionId)
		if (!/^[a-zA-Z0-9_-]+$/.test(input.executionId)) throw new Error("Invalid foreground execution ID")
		const record: CommandRecord = { version: 1, ...input, state: "observing" }
		const key = `${input.sessionId}\0${input.executionId}`
		if (this.owned.has(key)) throw new Error("Foreground execution already observed")
		const observation: OwnedObservation = { record, disconnect }
		try {
			mkdirSync(directory, { recursive: true })
		} catch (error) {
			Logger.warn("[ForegroundCommandObservations] Could not create observation directory", error)
		}
		this.owned.set(key, observation)
		this.persist(record)
		return {
			complete: (outcome, output) => {
				if (this.disposed || this.owned.get(key) !== observation || observation.record.state !== "observing") return
				// Record and notification share a synchronous boundary, independent of
				// output flushing or which session is currently selected.
				observation.record = outcome
					? { ...record, output, state: "completed", outcome }
					: { ...record, output, state: "lost" }
				if (this.persist(observation.record)) this.owned.delete(key)
				observation.disconnect = () => {}
				this.options.onChanged?.()
			},
		}
	}

	dispose(): void {
		if (this.disposed) return
		this.disposed = true
		for (const observation of this.owned.values()) {
			if (observation.record.state !== "observing") continue
			observation.record = { ...observation.record, output: this.readOutput(observation.record), state: "lost" }
			this.persist(observation.record)
			observation.disconnect()
		}
		this.owned.clear()
	}

	private read(sessionId: string): { records: CommandRecord[]; incomplete: boolean } {
		const records = new Map<string, CommandRecord>()
		let incomplete = false
		try {
			const directory = this.directory(sessionId)
			for (const filename of readdirSync(directory)) {
				if (!filename.endsWith(".json") || filename.includes(".tmp.")) continue
				try {
					const value = RecordSchema.parse(JSON.parse(readFileSync(path.join(directory, filename), "utf8")))
					if (value.sessionId !== sessionId || filename !== `${value.executionId}.json`) {
						incomplete = true
						continue
					}
					if (value.state === "completed") {
						const outcome = DetachedCommandOutcomeSchema.safeParse(value.outcome)
						records.set(
							value.executionId,
							outcome.success
								? { ...value, state: "completed", outcome: outcome.data }
								: { ...value, state: "lost" },
						)
					} else {
						records.set(value.executionId, { ...value, state: "lost" })
					}
				} catch {
					// Corrupt or unsupported records do not establish an outcome.
					incomplete = true
				}
			}
		} catch {
			// No accessible observation history; detached transcript rows stay unknown.
			incomplete = true
		}
		for (const { record } of this.owned.values()) {
			if (record.sessionId === sessionId) records.set(record.executionId, record)
		}
		return { records: [...records.values()].sort((a, b) => a.executionId.localeCompare(b.executionId)), incomplete }
	}

	private readOutput(command: CommandRecord): string {
		if (command.state !== "observing") return command.output
		let fd: number | undefined
		try {
			// The owner supplied this path. Disk records from a different observer
			// are never used to read arbitrary output files.
			fd = openSync(command.logPath, "r")
			const size = fstatSync(fd).size
			const buffer = Buffer.alloc(Math.min(size, MAX_COMMAND_OUTPUT_CHARS))
			const count = readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length))
			return buffer.subarray(0, count).toString("utf8") || command.output
		} catch {
			return command.output
		} finally {
			if (fd !== undefined) {
				try {
					closeSync(fd)
				} catch {
					/* Output capture is best effort. */
				}
			}
		}
	}

	projectMessages(sessionId: string, messages: ClineMessage[]): ClineMessage[] {
		if (!messages.some((message) => message.say === "command" && message.commandToolCallId)) return messages
		const { records, incomplete } = this.read(sessionId)
		return messages.map((message) => {
			if (message.say !== "command" || !message.commandToolCallId) return message
			const commands = records.filter((record) => record.toolCallId === message.commandToolCallId)
			const text = message.text ?? ""
			const legacyDetached = text.includes(FOREGROUND_DETACHED_RESULT_PREFIX)
			if (commands.length === 0 && !legacyDetached && !message.commandForegroundDetached) return message
			let status: NonNullable<ClineMessage["commandStatus"]> = message.commandToolCallFailed ? "failed" : "succeeded"
			const rank = { succeeded: 0, indeterminate: 1, failed: 2, killed: 3, running: 4 }
			const output: string[] = message.commandToolOutput ? [message.commandToolOutput] : []
			let lostRecord = incomplete
			// A parallel batch may have only some readable records. Account for
			// every foreground detach result before accepting aggregate success.
			const resultText = message.commandToolOutput ?? ""
			for (const line of resultText.split("\n")) {
				if (!line.startsWith(FOREGROUND_DETACHED_RESULT_PREFIX)) continue
				const logPath = line.slice(FOREGROUND_DETACHED_RESULT_PREFIX.length).trim()
				if (!commands.some((record) => record.logPath === logPath)) lostRecord = true
			}
			for (const command of commands) {
				const next =
					command.state === "observing"
						? "running"
						: command.state === "lost"
							? "indeterminate"
							: detachedCommandBackgroundStatus(command.outcome)
				if (rank[next] > rank[status]) status = next
				output.push(`[Command output log: ${command.logPath}]`)
				const capturedOutput = this.readOutput(command)
				if (capturedOutput) output.push(capturedOutput)
				output.push(
					command.state === "completed"
						? formatDetachedCompletionNote(command.outcome)
						: command.state === "observing"
							? "[Command is still running; Cline is observing its terminal output.]"
							: LOST_OBSERVATION_NOTE,
				)
			}
			if (commands.length === 0) {
				status = "indeterminate"
				output.length = 0
				output.push(
					(message.commandToolOutput ?? text.split(COMMAND_OUTPUT_STRING).slice(1).join(COMMAND_OUTPUT_STRING))
						.replace(`\n${LOST_OBSERVATION_NOTE}`, "")
						.trim(),
					LOST_OBSERVATION_NOTE,
				)
			}
			if (lostRecord && commands.length > 0) {
				if (rank[status] < rank.indeterminate) status = "indeterminate"
				output.push(LOST_OBSERVATION_NOTE)
			}
			// The tool may still be waiting for another foreground command in the
			// same batch even after all currently detached executions have settled.
			if (
				!message.commandToolCallEnded &&
				message.partial &&
				commands.length > 0 &&
				commands.every((record) => record.state !== "lost") &&
				!this.disposed
			)
				status = "running"
			const nextText = `${text.split(COMMAND_OUTPUT_STRING)[0].trim()}\n${COMMAND_OUTPUT_STRING}\n${output.filter(Boolean).join("\n")}`
			const completed = status !== "running"
			if (
				text === nextText &&
				message.commandStatus === status &&
				message.commandCompleted === completed &&
				message.partial === !completed
			)
				return message
			return {
				...message,
				commandForegroundDetached: true,
				text: nextText,
				commandStatus: status,
				commandCompleted: completed,
				partial: !completed,
			}
		})
	}
}

export const LOST_OBSERVATION_NOTE =
	"[Cline is no longer observing this command. It may still be running, but further terminal output and its exit status cannot be recovered automatically.]"

export const FOREGROUND_DETACHED_RESULT_PREFIX =
	"This is partial output; further output is being redirected to this file, which you can read to check progress: "
