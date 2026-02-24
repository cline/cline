import { useState } from "react"
import { Controller } from "@/core/controller"
import { getAvailableSlashCommands } from "@/core/controller/slash/getAvailableSlashCommands"
import { EmptyRequest, SlashCommandInfo } from "@/shared/proto/index.cline"
import { CLI_ONLY_COMMANDS } from "@/shared/slashCommands"
import { fuzzyFilter } from "../utils/fuzzy-search"

interface SlashQueryInfo {
	inSlashMode: boolean
	query: string
	slashIndex: number
}

const EMPTY_RESULT = { cmds: [], allCmds: [], slashInfo: { inSlashMode: false, query: "", slashIndex: -1 } }

export const useFilteredSlashCommands = (
	ctrl: Controller,
	textInput: string,
	cursorPos: number,
): { cmds: SlashCommandInfo[]; allCmds: SlashCommandInfo[]; slashInfo: SlashQueryInfo } => {
	const [allCommands, setAllCommands] = useState<SlashCommandInfo[]>([])
	if (!ctrl) return EMPTY_RESULT
	getAvailableSlashCommands(ctrl, EmptyRequest.create())
		.then((response) => {
			const cliCommands = response.commands.filter((cmd) => cmd.cliCompatible !== false)
			const sorted = [...CLI_ONLY_COMMANDS, ...sortCommandsWorkflowsFirst(cliCommands)]
			setAllCommands(sorted)
		})
		.catch(() => {
			setAllCommands([])
		})
	const slashInfo = extractSlashQuery(textInput, cursorPos)
	const filteredCmds = slashInfo.inSlashMode ? fuzzyFilter(allCommands, slashInfo.query, (cmd) => cmd.name) : []
	return { cmds: filteredCmds, allCmds: allCommands, slashInfo }
}

/**
 * Sort commands with workflows (custom section) first, then default commands.
 */
function sortCommandsWorkflowsFirst(commands: SlashCommandInfo[]): SlashCommandInfo[] {
	return [...commands.filter((cmd) => cmd.section === "custom"), ...commands.filter((cmd) => cmd.section !== "custom")]
}

function extractSlashQuery(text: string, cursorPosition?: number): SlashQueryInfo {
	// Use text up to cursor position (or full text if no cursor position provided)
	const beforeCursor = cursorPosition !== undefined ? text.slice(0, cursorPosition) : text

	// Find the last slash before cursor
	const slashIndex = beforeCursor.lastIndexOf("/")

	if (slashIndex === -1) {
		return { inSlashMode: false, query: "", slashIndex: -1 }
	}

	// Slash must be at start or preceded by whitespace
	const charBeforeSlash = slashIndex > 0 ? beforeCursor[slashIndex - 1] : null
	if (charBeforeSlash !== null && !/\s/.test(charBeforeSlash)) {
		return { inSlashMode: false, query: "", slashIndex: -1 }
	}

	// Get text after slash (up to cursor)
	const textAfterSlash = beforeCursor.slice(slashIndex + 1)

	// If there's whitespace after slash, we're not in slash mode anymore
	if (/\s/.test(textAfterSlash)) {
		return { inSlashMode: false, query: "", slashIndex: -1 }
	}

	// Check if there's already a completed slash command earlier in the text
	// (only first slash command per message is processed)
	const firstSlashCommandRegex = /(^|\s)\/[a-zA-Z0-9_.-]+\s/
	const textBeforeCurrentSlash = text.slice(0, slashIndex)
	if (firstSlashCommandRegex.test(textBeforeCurrentSlash)) {
		return { inSlashMode: false, query: "", slashIndex: -1 }
	}

	return {
		inSlashMode: true,
		query: textAfterSlash,
		slashIndex,
	}
}
