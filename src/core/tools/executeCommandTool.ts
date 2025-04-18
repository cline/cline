import fs from "fs/promises"
import * as path from "path"

import delay from "delay"

import { Cline } from "../Cline"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag, ToolResponse } from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { unescapeHtmlEntities } from "../../utils/text-normalization"
import { ExitCodeDetails, TerminalProcess } from "../../integrations/terminal/TerminalProcess"
import { Terminal } from "../../integrations/terminal/Terminal"
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry"
import { telemetryService } from "../../services/telemetry/TelemetryService"

export async function executeCommandTool(
	cline: Cline,
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

			const [userRejected, result] = await executeCommand(cline, command, customCwd)

			if (userRejected) {
				cline.didRejectTool = true
			}

			pushToolResult(result)

			return
		}
	} catch (error) {
		await handleError("executing command", error)
		return
	}
}

export async function executeCommand(
	cline: Cline,
	command: string,
	customCwd?: string,
): Promise<[boolean, ToolResponse]> {
	let workingDir: string

	if (!customCwd) {
		workingDir = cline.cwd
	} else if (path.isAbsolute(customCwd)) {
		workingDir = customCwd
	} else {
		workingDir = path.resolve(cline.cwd, customCwd)
	}

	// Check if directory exists
	try {
		await fs.access(workingDir)
	} catch (error) {
		return [false, `Working directory '${workingDir}' does not exist.`]
	}

	const terminalInfo = await TerminalRegistry.getOrCreateTerminal(workingDir, !!customCwd, cline.taskId)

	// Update the working directory in case the terminal we asked for has
	// a different working directory so that the model will know where the
	// command actually executed:
	workingDir = terminalInfo.getCurrentWorkingDirectory()

	const workingDirInfo = workingDir ? ` from '${workingDir.toPosix()}'` : ""
	terminalInfo.terminal.show() // weird visual bug when creating new terminals (even manually) where there's an empty space at the top.
	let userFeedback: { text?: string; images?: string[] } | undefined
	let didContinue = false
	let completed = false
	let result: string = ""
	let exitDetails: ExitCodeDetails | undefined
	const { terminalOutputLineLimit = 500 } = (await cline.providerRef.deref()?.getState()) ?? {}

	const sendCommandOutput = async (line: string, terminalProcess: TerminalProcess): Promise<void> => {
		try {
			const { response, text, images } = await cline.ask("command_output", line)
			if (response === "yesButtonClicked") {
				// proceed while running
			} else {
				userFeedback = { text, images }
			}
			didContinue = true
			terminalProcess.continue() // continue past the await
		} catch {
			// This can only happen if this ask promise was ignored, so ignore this error
		}
	}

	const process = terminalInfo.runCommand(command, {
		onLine: (line, process) => {
			if (!didContinue) {
				sendCommandOutput(Terminal.compressTerminalOutput(line, terminalOutputLineLimit), process)
			} else {
				cline.say("command_output", Terminal.compressTerminalOutput(line, terminalOutputLineLimit))
			}
		},
		onCompleted: (output) => {
			result = output ?? ""
			completed = true
		},
		onShellExecutionComplete: (details) => {
			exitDetails = details
		},
		onNoShellIntegration: async (message) => {
			telemetryService.captureShellIntegrationError(cline.taskId)
			await cline.say("shell_integration_warning", message)
		},
	})

	await process

	// Wait for a short delay to ensure all messages are sent to the webview
	// This delay allows time for non-awaited promises to be created and
	// for their associated messages to be sent to the webview, maintaining
	// the correct order of messages (although the webview is smart about
	// grouping command_output messages despite any gaps anyways)
	await delay(50)

	result = Terminal.compressTerminalOutput(result, terminalOutputLineLimit)

	// keep in case we need it to troubleshoot user issues, but this should be removed in the future
	// if everything looks good:
	console.debug(
		"[execute_command status]",
		JSON.stringify(
			{
				completed,
				userFeedback,
				hasResult: result.length > 0,
				exitDetails,
				terminalId: terminalInfo.id,
				workingDir: workingDirInfo,
				isTerminalBusy: terminalInfo.busy,
			},
			null,
			2,
		),
	)

	if (userFeedback) {
		await cline.say("user_feedback", userFeedback.text, userFeedback.images)

		return [
			true,
			formatResponse.toolResult(
				`Command is still running in terminal ${terminalInfo.id}${workingDirInfo}.${
					result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
				}\n\nThe user provided the following feedback:\n<feedback>\n${userFeedback.text}\n</feedback>`,
				userFeedback.images,
			),
		]
	} else if (completed) {
		let exitStatus: string = ""

		if (exitDetails !== undefined) {
			if (exitDetails.signal) {
				exitStatus = `Process terminated by signal ${exitDetails.signal} (${exitDetails.signalName})`

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

		let workingDirInfo: string = workingDir ? ` within working directory '${workingDir.toPosix()}'` : ""
		const newWorkingDir = terminalInfo.getCurrentWorkingDirectory()

		if (newWorkingDir !== workingDir) {
			workingDirInfo += `\nNOTICE: Your command changed the working directory for this terminal to '${newWorkingDir.toPosix()}' so you MUST adjust future commands accordingly because they will be executed in this directory`
		}

		const outputInfo = `\nOutput:\n${result}`
		return [false, `Command executed in terminal ${terminalInfo.id}${workingDirInfo}. ${exitStatus}${outputInfo}`]
	} else {
		return [
			false,
			`Command is still running in terminal ${terminalInfo.id}${workingDirInfo}.${
				result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
			}\n\nYou will be updated on the terminal status and new output in the future.`,
		]
	}
}
