import { newTaskToolResponse, condenseToolResponse, newRuleToolResponse, reportBugToolResponse } from "../prompts/commands"
import { ClineRulesToggles } from "@shared/cline-rules"
import fs from "fs/promises"

/**
 * Processes text for slash commands and transforms them with appropriate instructions
 * This is called after parseMentions() to process any slash commands in the user's message
 */
export async function parseSlashCommands(
	text: string,
	localWorkflowToggles: ClineRulesToggles,
	globalWorkflowToggles: ClineRulesToggles,
): Promise<{ processedText: string; needsClinerulesFileCheck: boolean }> {
	const SUPPORTED_DEFAULT_COMMANDS = ["newtask", "smol", "compact", "newrule", "reportbug"]

	const commandReplacements: Record<string, string> = {
		newtask: newTaskToolResponse(),
		smol: condenseToolResponse(),
		compact: condenseToolResponse(),
		newrule: newRuleToolResponse(),
		reportbug: reportBugToolResponse(),
	}

	// this currently allows matching prepended whitespace prior to /slash-command
	const tagPatterns = [
		{ tag: "task", regex: /<task>(\s*\/([a-zA-Z0-9_\.-]+))(\s+.+?)?\s*<\/task>/is },
		{ tag: "feedback", regex: /<feedback>(\s*\/([a-zA-Z0-9_\.-]+))(\s+.+?)?\s*<\/feedback>/is },
		{ tag: "answer", regex: /<answer>(\s*\/([a-zA-Z0-9_\.-]+))(\s+.+?)?\s*<\/answer>/is },
		{ tag: "user_message", regex: /<user_message>(\s*\/([a-zA-Z0-9_\.-]+))(\s+.+?)?\s*<\/user_message>/is },
	]

	// if we find a valid match, we will return inside that block
	for (const { tag, regex } of tagPatterns) {
		const regexObj = new RegExp(regex.source, regex.flags)
		const match = regexObj.exec(text)

		if (match) {
			// match[1] is the command with any leading whitespace (e.g. " /newtask")
			// match[2] is just the command name (e.g. "newtask")

			const commandName = match[2] // casing matters

			// we give preference to the default commands if the user has a file with the same name
			if (SUPPORTED_DEFAULT_COMMANDS.includes(commandName)) {
				const fullMatchStartIndex = match.index

				// find position of slash command within the full match
				const fullMatch = match[0]
				const relativeStartIndex = fullMatch.indexOf(match[1])

				// calculate absolute indices in the original string
				const slashCommandStartIndex = fullMatchStartIndex + relativeStartIndex
				const slashCommandEndIndex = slashCommandStartIndex + match[1].length

				// remove the slash command and add custom instructions at the top of this message
				const textWithoutSlashCommand = text.substring(0, slashCommandStartIndex) + text.substring(slashCommandEndIndex)
				const processedText = commandReplacements[commandName] + textWithoutSlashCommand

				return { processedText: processedText, needsClinerulesFileCheck: commandName === "newrule" ? true : false }
			}

			const globalWorkflows = Object.entries(globalWorkflowToggles)
				.filter(([_, enabled]) => enabled)
				.map(([filePath, _]) => {
					const fileName = filePath.replace(/^.*[/\\]/, "")
					return {
						fullPath: filePath,
						fileName: fileName,
					}
				})

			const localWorkflows = Object.entries(localWorkflowToggles)
				.filter(([_, enabled]) => enabled)
				.map(([filePath, _]) => {
					const fileName = filePath.replace(/^.*[/\\]/, "")
					return {
						fullPath: filePath,
						fileName: fileName,
					}
				})

			// local workflows have precedence over global workflows
			const enabledWorkflows = [...localWorkflows, ...globalWorkflows]

			// Then check if the command matches any enabled workflow filename
			const matchingWorkflow = enabledWorkflows.find((workflow) => workflow.fileName === commandName)

			if (matchingWorkflow) {
				try {
					// Read workflow file content from the full path
					const workflowContent = (await fs.readFile(matchingWorkflow.fullPath, "utf8")).trim()

					// find position of slash command within the full match
					const fullMatchStartIndex = match.index
					const fullMatch = match[0]
					const relativeStartIndex = fullMatch.indexOf(match[1])

					// calculate absolute indices in the original string
					const slashCommandStartIndex = fullMatchStartIndex + relativeStartIndex
					const slashCommandEndIndex = slashCommandStartIndex + match[1].length

					// remove the slash command and add custom instructions at the top of this message
					const textWithoutSlashCommand =
						text.substring(0, slashCommandStartIndex) + text.substring(slashCommandEndIndex)
					const processedText =
						`<explicit_instructions type="${matchingWorkflow.fileName}">\n${workflowContent}\n</explicit_instructions>\n` +
						textWithoutSlashCommand

					return { processedText, needsClinerulesFileCheck: false }
				} catch (error) {
					console.error(`Error reading workflow file ${matchingWorkflow.fullPath}: ${error}`)
				}
			}
		}
	}

	// if no supported commands are found, return the original text
	return { processedText: text, needsClinerulesFileCheck: false }
}
