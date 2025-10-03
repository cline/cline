import { setTimeout as setTimeoutPromise } from "node:timers/promises"

import { formatResponse } from "@core/prompts/responses"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { TerminalManager } from "@integrations/terminal/TerminalManager"
import { Logger } from "@services/logging/Logger"
import { execa } from "execa"
import { TerminalHangStage, TerminalUserInterventionAction, telemetryService } from "@/services/telemetry"
import { isInTestMode } from "@/services/test/TestMode"

import type { AskFn, CommandRunnerResult, SayFn } from "../types"

export class CommandRunner {
	constructor(
		private readonly cwd: string,
		private readonly terminalManager: TerminalManager,
		private readonly ask: AskFn,
		private readonly say: SayFn,
	) {}

	private async executeInNode(command: string): Promise<CommandRunnerResult> {
		try {
			const childProcess = execa(command, {
				shell: true,
				cwd: this.cwd,
				reject: false,
				all: true,
			})

			let output = ""

			if (childProcess.all) {
				childProcess.all.on("data", (data) => {
					output += data.toString()
				})
			}

			const timeoutPromise = new Promise<never>((_, reject) => {
				setTimeout(() => {
					if (childProcess.pid) {
						childProcess.kill("SIGKILL")
					}
					reject(new Error("Command timeout after 30s"))
				}, 30000)
			})

			const result = await Promise.race([childProcess, timeoutPromise]).catch((_error) => {
				Logger.info(`Command timed out after 30s: ${command}`)
				return {
					stdout: "",
					stderr: "",
					exitCode: 124,
					timedOut: true,
				}
			})

			const wasTerminated = result.timedOut === true

			if (!output) {
				output = result.stdout || result.stderr || ""
			}

			Logger.info(`Command executed in Node: ${command}\nOutput:\n${output}`)

			if (wasTerminated) {
				output += "\nCommand was taking a while to run so it was auto terminated after 30s"
			}

			return [
				false,
				`Command executed${wasTerminated ? " (terminated after 30s)" : ""} with exit code ${
					result.exitCode
				}.${output.length > 0 ? `\nOutput:\n${output}` : ""}`,
			]
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			return [false, `Error executing command: ${errorMessage}`]
		}
	}

	async execute(command: string, timeoutSeconds: number | undefined): Promise<CommandRunnerResult> {
		Logger.info("IS_TEST: " + isInTestMode())

		if (isInTestMode()) {
			Logger.info("Executing command in Node: " + command)
			return this.executeInNode(command)
		}

		Logger.info("Executing command in terminal: " + command)

		const terminalInfo = await this.terminalManager.getOrCreateTerminal(this.cwd)
		terminalInfo.terminal.show()
		const terminalProcess = this.terminalManager.runCommand(terminalInfo, command)

		let userFeedback: { text?: string; images?: string[]; files?: string[] } | undefined
		let didContinue = false

		const CHUNK_LINE_COUNT = 20
		const CHUNK_BYTE_SIZE = 2048
		const CHUNK_DEBOUNCE_MS = 100

		let outputBuffer: string[] = []
		let outputBufferSize = 0
		let chunkTimer: NodeJS.Timeout | null = null
		let chunkEnroute = false

		let bufferStuckTimer: NodeJS.Timeout | null = null
		const BUFFER_STUCK_TIMEOUT_MS = 6000

		const flushBuffer = async (force = false): Promise<void> => {
			if (chunkEnroute || outputBuffer.length === 0) {
				if (force && !chunkEnroute && outputBuffer.length > 0) {
					// fallthrough to flush
				} else {
					return
				}
			}

			const chunk = outputBuffer.join("\n")
			outputBuffer = []
			outputBufferSize = 0
			chunkEnroute = true

			bufferStuckTimer = setTimeout(() => {
				telemetryService.captureTerminalHang(TerminalHangStage.BUFFER_STUCK)
				bufferStuckTimer = null
			}, BUFFER_STUCK_TIMEOUT_MS)

			try {
				const { response, text, images, files } = await this.ask("command_output", chunk)
				if (response === "yesButtonClicked") {
					telemetryService.captureTerminalUserIntervention(TerminalUserInterventionAction.PROCESS_WHILE_RUNNING)
					if (text || (images && images.length > 0) || (files && files.length > 0)) {
						userFeedback = { text, images, files }
					}
				} else {
					userFeedback = { text, images, files }
				}
				didContinue = true
				terminalProcess.continue()
			} catch {
				Logger.error("Error while asking for command output")
			} finally {
				if (bufferStuckTimer) {
					clearTimeout(bufferStuckTimer)
					bufferStuckTimer = null
				}
				chunkEnroute = false
				if (outputBuffer.length > 0) {
					await flushBuffer()
				}
			}
		}

		const scheduleFlush = () => {
			if (chunkTimer) {
				clearTimeout(chunkTimer)
			}
			chunkTimer = setTimeout(async () => await flushBuffer(), CHUNK_DEBOUNCE_MS)
		}

		const outputLines: string[] = []
		terminalProcess.on("line", async (line) => {
			outputLines.push(line)

			if (!didContinue) {
				outputBuffer.push(line)
				outputBufferSize += Buffer.byteLength(line, "utf8")
				if (outputBuffer.length >= CHUNK_LINE_COUNT || outputBufferSize >= CHUNK_BYTE_SIZE) {
					await flushBuffer()
				} else {
					scheduleFlush()
				}
			} else {
				void this.say("command_output", line)
			}
		})

		let completed = false
		let completionTimer: NodeJS.Timeout | null = null
		const COMPLETION_TIMEOUT_MS = 6000

		completionTimer = setTimeout(() => {
			if (!completed) {
				telemetryService.captureTerminalHang(TerminalHangStage.WAITING_FOR_COMPLETION)
				completionTimer = null
			}
		}, COMPLETION_TIMEOUT_MS)

		terminalProcess.once("completed", async () => {
			completed = true
			if (completionTimer) {
				clearTimeout(completionTimer)
				completionTimer = null
			}
			if (!didContinue && outputBuffer.length > 0) {
				if (chunkTimer) {
					clearTimeout(chunkTimer)
					chunkTimer = null
				}
				await flushBuffer(true)
			}
		})

		terminalProcess.once("no_shell_integration", async () => {
			await this.say("shell_integration_warning")
		})

		if (timeoutSeconds) {
			const timeoutPromise = new Promise<never>((_, reject) => {
				setTimeout(() => {
					reject(new Error("COMMAND_TIMEOUT"))
				}, timeoutSeconds * 1000)
			})

			try {
				await Promise.race([terminalProcess, timeoutPromise])
			} catch (error) {
				didContinue = true
				terminalProcess.continue()

				if (chunkTimer) {
					clearTimeout(chunkTimer)
					chunkTimer = null
				}
				if (completionTimer) {
					clearTimeout(completionTimer)
					completionTimer = null
				}

				await setTimeoutPromise(50)
				const result = this.terminalManager.processOutput(outputLines)

				if (error instanceof Error && error.message === "COMMAND_TIMEOUT") {
					return [
						false,
						`Command execution timed out after ${timeoutSeconds} seconds. The command may still be running in the terminal.${
							result.length > 0 ? `\nOutput so far:\n${result}` : ""
						}`,
					]
				}

				throw error
			}
		} else {
			await terminalProcess
		}

		if (completionTimer) {
			clearTimeout(completionTimer)
			completionTimer = null
		}

		await setTimeoutPromise(50)

		const result = this.terminalManager.processOutput(outputLines)

		if (userFeedback) {
			await this.say("user_feedback", userFeedback.text, userFeedback.images, userFeedback.files)

			let fileContentString = ""
			if (userFeedback.files && userFeedback.files.length > 0) {
				fileContentString = await processFilesIntoText(userFeedback.files)
			}

			return [
				true,
				formatResponse.toolResult(
					`Command is still running in the user's terminal.${
						result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
					}\n\nThe user provided the following feedback:\n<feedback>\n${userFeedback.text}\n</feedback>`,
					userFeedback.images,
					fileContentString,
				),
			]
		}

		if (completed) {
			return [false, `Command executed.${result.length > 0 ? `\nOutput:\n${result}` : ""}`]
		}

		return [
			false,
			`Command is still running in the user's terminal.${
				result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
			}\n\nYou will be updated on the terminal status and new output in the future.`,
		]
	}
}
