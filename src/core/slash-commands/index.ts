import { newTaskToolResponse, condenseToolResponse, newRuleToolResponse, reportBugToolResponse } from "../prompts/commands"
import { BrowserSession } from "@services/browser/BrowserSession"
import { BrowserSettings } from "@shared/BrowserSettings"

/**
 * Processes text for slash commands and transforms them with appropriate instructions
 * This is called after parseMentions() to process any slash commands in the user's message
 */
export async function parseSlashCommands(
	text: string,
	browserSettings: BrowserSettings,
	browserSession: BrowserSession,
): Promise<{ processedText: string; needsClinerulesFileCheck: boolean }> {
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

				let processedText
				if (commandName !== "reportbug") {
					processedText = commandReplacements[commandName] + textWithoutSlashCommand
				} else {
					// we require special handling for /reportbug, specifically checking if remote browser connection is on
					let remoteBrowserEnabled = false
					try {
						if (browserSettings.remoteBrowserEnabled && browserSettings.remoteBrowserHost) {
							const browserConnectionCheck = await browserSession.testConnection(browserSettings.remoteBrowserHost)
							remoteBrowserEnabled = browserConnectionCheck.success
						}
					} catch (error) {
						console.error("Error testing browser connection for /reportbug:", error)
					}

					processedText = reportBugToolResponse(remoteBrowserEnabled) + textWithoutSlashCommand
				}

				return { processedText: processedText, needsClinerulesFileCheck: commandName === "newrule" }
			}
		}
	}

	// if no supported commands are found, return the original text
	return { processedText: text, needsClinerulesFileCheck: false }
}
