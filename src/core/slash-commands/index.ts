import { newTaskToolResponse, condenseToolResponse, newRuleToolResponse, reportBugToolResponse } from "../prompts/commands"
import * as vscode from "vscode"
import os from "os"
import { ApiHandler } from "@api/index"

/**
 * Collects system and extension information
 */
function collectReportData(context: vscode.ExtensionContext, api: ApiHandler): string {
	// 1. Get Cline version
	let clineVersionString = ""
	try {
		const clineVersion = context.extension?.packageJSON?.version || "unknown"
		clineVersionString = `Cline Version:\n- Version: ${clineVersion}`
	} catch (error) {}

	// 2. Get OS information
	let operatingSystemString = ""
	try {
		operatingSystemString = `Operating System:\n- Platform: ${process.platform}\n- Release: ${os.release()}\n- Version: ${os.version()}`
	} catch (error) {}

	// 3. Get detailed system info
	let systemInfoString = ""
	try {
		const systemInfo = JSON.stringify(
			{
				arch: process.arch,
				nodeVersion: process.version,
				vscodeVersion: vscode.version,
				totalmem: (os.totalmem() / (1024 * 1024 * 1024)).toFixed(1) + "GB",
				freemem: (os.freemem() / (1024 * 1024 * 1024)).toFixed(1) + "GB",
				cpus: os.cpus().length,
				cpuModel: os.cpus()[0]?.model || "unknown",
			},
			null,
			2,
		)
		systemInfoString = `System info:\n- Info: ${systemInfo}`
	} catch (error) {}

	// 4. Get Provider and Model info
	let providerAndModelString = ""
	try {
		const apiProvider = (context.globalState.get("apiProvider") as string) || "unknown"
		const modelId = api.getModel().id || "unknown"
		providerAndModelString = `Provider/Model:\n- Provider: ${apiProvider}\n- Model: ${modelId}`
	} catch (error) {}

	let reportDataString = ""
	if (clineVersionString || operatingSystemString || systemInfoString || providerAndModelString) {
		reportDataString = `${clineVersionString}\n\n${operatingSystemString}\n\n${systemInfoString}\n\n${providerAndModelString}`
	}
	return reportDataString
}

/**
 * Processes text for slash commands and transforms them with appropriate instructions
 * This is called after parseMentions() to process any slash commands in the user's message
 */
export function parseSlashCommands(
	text: string,
	context: vscode.ExtensionContext,
	api: ApiHandler,
): { processedText: string; needsClinerulesFileCheck: boolean } {
	const SUPPORTED_COMMANDS = ["newtask", "smol", "compact", "newrule", "reportbug"]

	const commandReplacements: Record<string, string> = {
		newtask: newTaskToolResponse(),
		smol: condenseToolResponse(),
		compact: condenseToolResponse(),
		newrule: newRuleToolResponse(),
	}

	// this currently allows matching prepended whitespace prior to /slash-command
	const tagPatterns = [
		{ tag: "task", regex: /<task>(\s*\/([a-zA-Z0-9_-]+))(\s+.+?)?\s*<\/task>/is },
		{ tag: "feedback", regex: /<feedback>(\s*\/([a-zA-Z0-9_-]+))(\s+.+?)?\s*<\/feedback>/is },
		{ tag: "answer", regex: /<answer>(\s*\/([a-zA-Z0-9_-]+))(\s+.+?)?\s*<\/answer>/is },
		{ tag: "user_message", regex: /<user_message>(\s*\/([a-zA-Z0-9_-]+))(\s+.+?)?\s*<\/user_message>/is },
	]

	// if we find a valid match, we will return inside that block
	for (const { tag, regex } of tagPatterns) {
		const regexObj = new RegExp(regex.source, regex.flags)
		const match = regexObj.exec(text)

		if (match) {
			// match[1] is the command with any leading whitespace (e.g. " /newtask")
			// match[2] is just the command name (e.g. "newtask")

			const commandName = match[2] // casing matters

			if (SUPPORTED_COMMANDS.includes(commandName)) {
				const fullMatchStartIndex = match.index

				// find position of slash command within the full match
				const fullMatch = match[0]
				const relativeStartIndex = fullMatch.indexOf(match[1])

				// calculate absolute indices in the original string
				const slashCommandStartIndex = fullMatchStartIndex + relativeStartIndex
				const slashCommandEndIndex = slashCommandStartIndex + match[1].length

				// remove the slash command and add custom instructions at the top of this message
				const textWithoutSlashCommand = text.substring(0, slashCommandStartIndex) + text.substring(slashCommandEndIndex)

				let processedText = ""
				if (commandName !== "reportbug") {
					processedText = commandReplacements[commandName] + textWithoutSlashCommand
				} else {
					const systemData = collectReportData(context, api)
					processedText = reportBugToolResponse(systemData) + textWithoutSlashCommand
				}

				return { processedText: processedText, needsClinerulesFileCheck: commandName === "newrule" ? true : false }
			}
		}
	}

	// if no supported commands are found, return the original text
	return { processedText: text, needsClinerulesFileCheck: false }
}
