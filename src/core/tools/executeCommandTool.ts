import fs from "fs/promises"
import * as path from "path"

import delay from "delay"

import { CommandExecutionStatus } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { Task } from "../task/Task"

import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag, ToolResponse } from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { unescapeHtmlEntities } from "../../utils/text-normalization"
import { ExitCodeDetails, RooTerminalCallbacks, RooTerminalProcess } from "../../integrations/terminal/types"
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry"
import { Terminal } from "../../integrations/terminal/Terminal"

class ShellIntegrationError extends Error {}

export async function executeCommandTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	let command: string | undefined = block.params.command
	const customCwd: string | undefined = block.params.cwd

	try {
		if (block.partial) {
			await cline.ask("command", removeClosingTag("command", command), block.partial).catch(() => {})
			return
		} else {
			if (!command) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("execute_command")
				pushToolResult(await cline.sayAndCreateMissingParamError("execute_command", "command"))
				return
			}

			const ignoredFileAttemptedToAccess = cline.rooIgnoreController?.validateCommand(command)

			if (ignoredFileAttemptedToAccess) {
				await cline.say("rooignore_error", ignoredFileAttemptedToAccess)
				pushToolResult(formatResponse.toolError(formatResponse.rooIgnoreError(ignoredFileAttemptedToAccess)))
				return
			}

			cline.consecutiveMistakeCount = 0

			command = unescapeHtmlEntities(command) // Unescape HTML entities.
			const didApprove = await askApproval("command", command)

			if (!didApprove) {
				return
			}

			const executionId = cline.lastMessageTs?.toString() ?? Date.now().toString()
			const clineProvider = await cline.providerRef.deref()
			const clineProviderState = await clineProvider?.getState()
			const { terminalOutputLineLimit = 500, terminalShellIntegrationDisabled = false } = clineProviderState ?? {}

			const options: ExecuteCommandOptions = {
				executionId,
				command,
				customCwd,
				terminalShellIntegrationDisabled,
				terminalOutputLineLimit,
			}

			try {
				const [rejected, result] = await executeCommand(cline, options)

				if (rejected) {
					cline.didRejectTool = true
				}

				pushToolResult(result)
			} catch (error: unknown) {
				const status: CommandExecutionStatus = { executionId, status: "fallback" }
				clineProvider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
				await cline.say("shell_integration_warning")

				if (error instanceof ShellIntegrationError) {
					const [rejected, result] = await executeCommand(cline, {
						...options,
						terminalShellIntegrationDisabled: true,
					})

					if (rejected) {
						cline.didRejectTool = true
					}

					pushToolResult(result)
				} else {
					pushToolResult(`Command failed to execute in terminal due to a shell integration error.`)
				}
			}

			return
		}
	} catch (error) {
		await handleError("executing command", error)
		return
	}
}

export type ExecuteCommandOptions = {
	executionId: string
	command: string
	customCwd?: string
	terminalShellIntegrationDisabled?: boolean
	terminalOutputLineLimit?: number
}

export async function executeCommand(
	cline: Task,
	{
		executionId,
		command,
		customCwd,
		terminalShellIntegrationDisabled = false,
		terminalOutputLineLimit = 500,
	}: ExecuteCommandOptions,
): Promise<[boolean, ToolResponse]> {
	let workingDir: string

	if (!customCwd) {
		workingDir = cline.cwd
	} else if (path.isAbsolute(customCwd)) {
		workingDir = customCwd
	} else {
		workingDir = path.resolve(cline.cwd, customCwd)
	}

	try {
		await fs.access(workingDir)
	} catch (error) {
		return [false, `Working directory '${workingDir}' does not exist.`]
	}

	let message: { text?: string; images?: string[] } | undefined
	let runInBackground = false
	let completed = false
	let result: string = ""
	let exitDetails: ExitCodeDetails | undefined
	let shellIntegrationError: string | undefined

	const terminalProvider = terminalShellIntegrationDisabled ? "execa" : "vscode"
	const clineProvider = await cline.providerRef.deref()

	let accumulatedOutput = ""
	const callbacks: RooTerminalCallbacks = {
		onLine: async (lines: string, process: RooTerminalProcess) => {
			accumulatedOutput += lines
			const compressedOutput = Terminal.compressTerminalOutput(accumulatedOutput, terminalOutputLineLimit)
			const status: CommandExecutionStatus = { executionId, status: "output", output: compressedOutput }
			clineProvider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })

			if (runInBackground) {
				return
			}

			try {
				const { response, text, images } = await cline.ask("command_output", "")
				runInBackground = true

				if (response === "messageResponse") {
					message = { text, images }
					process.continue()
				}
			} catch (_error) {}
		},
		onCompleted: (output: string | undefined) => {
			result = Terminal.compressTerminalOutput(output ?? "", terminalOutputLineLimit)
			cline.say("command_output", result)
			completed = true
		},
		onShellExecutionStarted: (pid: number | undefined) => {
			console.log(`[executeCommand] onShellExecutionStarted: ${pid}`)
			const status: CommandExecutionStatus = { executionId, status: "started", pid, command }
			clineProvider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
		},
		onShellExecutionComplete: (details: ExitCodeDetails) => {
			const status: CommandExecutionStatus = { executionId, status: "exited", exitCode: details.exitCode }
			clineProvider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
			exitDetails = details
		},
	}

	if (terminalProvider === "vscode") {
		callbacks.onNoShellIntegration = async (error: string) => {
			TelemetryService.instance.captureShellIntegrationError(cline.taskId)
			shellIntegrationError = error
		}
	}

	const terminal = await TerminalRegistry.getOrCreateTerminal(workingDir, !!customCwd, cline.taskId, terminalProvider)

	if (terminal instanceof Terminal) {
		terminal.terminal.show(true)

		// Update the working directory in case the terminal we asked for has
		// a different working directory so that the model will know where the
		// command actually executed.
		workingDir = terminal.getCurrentWorkingDirectory()
	}

	const process = terminal.runCommand(command, callbacks)
	cline.terminalProcess = process

	await process
	cline.terminalProcess = undefined

	if (shellIntegrationError) {
		throw new ShellIntegrationError(shellIntegrationError)
	}

	// Wait for a short delay to ensure all messages are sent to the webview.
	// This delay allows time for non-awaited promises to be created and
	// for their associated messages to be sent to the webview, maintaining
	// the correct order of messages (although the webview is smart about
	// grouping command_output messages despite any gaps anyways).
	await delay(50)

	if (message) {
		const { text, images } = message
		await cline.say("user_feedback", text, images)

		return [
			true,
			formatResponse.toolResult(
				[
					`Command is still running in terminal from '${terminal.getCurrentWorkingDirectory().toPosix()}'.`,
					result.length > 0 ? `Here's the output so far:\n${result}\n` : "\n",
					`The user provided the following feedback:`,
					`<feedback>\n${text}\n</feedback>`,
				].join("\n"),
				images,
			),
		]
	} else if (completed || exitDetails) {
		let exitStatus: string = ""

		if (exitDetails !== undefined) {
			if (exitDetails.signalName) {
				exitStatus = `Process terminated by signal ${exitDetails.signalName}`

				if (exitDetails.coreDumpPossible) {
					exitStatus += " - core dump possible"
				}
			} else if (exitDetails.exitCode === undefined) {
				result += "<VSCE exit code is undefined: terminal output and command execution status is unknown.>"
				exitStatus = `Exit code: <undefined, notify user>`
			} else {
				if (exitDetails.exitCode !== 0) {
					exitStatus += "Command execution was not successful, inspect the cause and adjust as needed.\n"
				}

				exitStatus += `Exit code: ${exitDetails.exitCode}`
			}
		} else {
			result += "<VSCE exitDetails == undefined: terminal output and command execution status is unknown.>"
			exitStatus = `Exit code: <undefined, notify user>`
		}

		let workingDirInfo = ` within working directory '${workingDir.toPosix()}'`
		const newWorkingDir = terminal.getCurrentWorkingDirectory()

		return [false, `Command executed in terminal ${workingDirInfo}. ${exitStatus}\nOutput:\n${result}`]
	} else {
		return [
			false,
			[
				`Command is still running in terminal ${workingDir ? ` from '${workingDir.toPosix()}'` : ""}.`,
				result.length > 0 ? `Here's the output so far:\n${result}\n` : "\n",
				"You will be updated on the terminal status and new output in the future.",
			].join("\n"),
		]
	}
}
