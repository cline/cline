import { mentionRegexGlobal } from "@shared/context-mentions"
import { StringRequest } from "@shared/proto/cline/common"
import { FileServiceClient } from "@/services/grpc-client"
import { validateSlashCommand } from "@/utils/slash-commands"

// Optimized highlighting functions
const highlightSlashCommands = (text: string, withShadow = true) => {
	const match = text.match(/^\s*\/([a-zA-Z0-9_-]+)(\s*|$)/)
	if (!match || validateSlashCommand(match[1]) !== "full") {
		return text
	}

	const commandName = match[1]
	const commandEndIndex = match[0].length
	const beforeCommand = text.substring(0, text.indexOf("/"))
	const afterCommand = match[2] + text.substring(commandEndIndex)

	return [
		beforeCommand,
		<span className={withShadow ? "mention-context-highlight-with-shadow" : "mention-context-highlight"} key="slashCommand">
			/{commandName}
		</span>,
		afterCommand,
	]
}

export const highlightMentions = (text: string, withShadow = true) => {
	if (!mentionRegexGlobal.test(text)) {
		return text
	}

	const parts = text.split(mentionRegexGlobal)
	const result: (string | JSX.Element)[] = []

	for (let i = 0; i < parts.length; i++) {
		if (i % 2 === 0) {
			if (parts[i]) {
				result.push(parts[i])
			}
		} else {
			result.push(
				<span
					className={`${withShadow ? "mention-context-highlight-with-shadow" : "mention-context-highlight"} cursor-pointer`}
					key={`mention-${Math.floor(i / 2)}`}
					onClick={() => FileServiceClient.openMention(StringRequest.create({ value: parts[i] }))}>
					@{parts[i]}
				</span>,
			)
		}
	}

	return result.length === 1 ? result[0] : result
}

export const highlightText = (text?: string, withShadow = true) => {
	if (!text) {
		return text
	}

	const slashResult = highlightSlashCommands(text, withShadow)

	if (slashResult === text) {
		return highlightMentions(text, withShadow)
	}

	if (Array.isArray(slashResult) && slashResult.length === 3) {
		const [beforeCommand, commandElement, afterCommand] = slashResult as [string, JSX.Element, string]
		const mentionResult = highlightMentions(afterCommand, withShadow)

		return Array.isArray(mentionResult)
			? [beforeCommand, commandElement, ...mentionResult]
			: [beforeCommand, commandElement, mentionResult]
	}

	return slashResult
}
