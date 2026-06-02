import { COMMAND_OUTPUT_STRING } from "@shared/combineCommandSequences"

export interface CommandRowMessage {
	ask?: string
	commandCompleted?: boolean
	partial?: boolean
	say?: string
	text?: string
	type?: string
}

export interface CommandRowState {
	isCommandCompleted: boolean
	isCommandExecuting: boolean
	isCommandMessage: boolean
	isCommandPending: boolean
	title: string | undefined
}

export function getCommandRowState(
	message: CommandRowMessage,
	isLast: boolean,
	isRequestInProgress?: boolean,
): CommandRowState {
	const type = message.type === "ask" ? message.ask : message.say
	const isCommandMessage = type === "command"
	const commandHasOutput = message.text?.includes(COMMAND_OUTPUT_STRING) ?? false
	const isCommandCompleted = isCommandMessage && message.commandCompleted === true
	const isCommandExecuting =
		isCommandMessage &&
		!isCommandCompleted &&
		(commandHasOutput ||
			(message.type === "say" && (message.partial === true || (isLast && isRequestInProgress === true))))
	const isCommandPending = isCommandMessage && isLast && !isCommandCompleted && !isCommandExecuting
	const title = !isCommandMessage
		? undefined
		: isCommandCompleted
			? "Cline executed this command:"
			: isCommandExecuting
				? "Cline is executing this command:"
				: "Cline wants to execute this command:"

	return {
		isCommandCompleted,
		isCommandExecuting,
		isCommandMessage,
		isCommandPending,
		title,
	}
}
