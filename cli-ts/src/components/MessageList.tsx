/**
 * Message list component
 * Renders all messages from the task
 */

import { Box } from "ink"
import React from "react"
import { useTaskState } from "../context/TaskContext"
import { MessageRow } from "./MessageRow"

interface MessageListProps {
	verbose?: boolean
}

export const MessageList: React.FC<MessageListProps> = ({ verbose = false }) => {
	const state = useTaskState()
	const messages = state.clineMessages || []

	// Filter out some noisy messages when not verbose
	const messagesToShow = verbose
		? messages
		: messages.filter((m) => {
				// Show everything in non-verbose mode for now
				return true
			})

	return (
		<Box flexDirection="column">
			{messagesToShow.map((message, idx) => (
				<MessageRow key={`${message.ts}-${idx}`} message={message} verbose={verbose} />
			))}
		</Box>
	)
}
