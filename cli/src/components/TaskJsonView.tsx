/**
 * JSON Task view component
 * Outputs task messages as JSON instead of rich styled text
 */

import { Box } from "ink"
import React, { useEffect, useRef } from "react"
import { useTaskContext, useTaskState } from "../context/TaskContext"
import { useCompletionSignals } from "../hooks/useStateSubscriber"
import { originalConsoleLog } from "../utils/console"

interface TaskJsonViewProps {
	taskId?: string
	verbose?: boolean
	onComplete?: () => void
	onError?: () => void
}

/**
 * Output a JSON line to stdout
 */
function outputJson(data: object) {
	originalConsoleLog(JSON.stringify(data))
}

export const TaskJsonView: React.FC<TaskJsonViewProps> = ({ taskId: _taskId, verbose = false, onComplete, onError }) => {
	const state = useTaskState()
	const { isTaskComplete, getCompletionMessage } = useCompletionSignals()
	const { setIsComplete } = useTaskContext()
	// Track outputted messages by timestamp (don't re-output on updates)
	const outputtedMessages = useRef<Set<number>>(new Set())
	const hasOutputtedCompletion = useRef(false)

	// Determine the role for a message
	const getRole = (message: { type: string; ask?: string; say?: string }, index: number): "user" | "assistant" | "system" => {
		// User feedback messages
		if (message.say === "user_feedback" || message.say === "user_feedback_diff") {
			return "user"
		}
		// First text message is the user's task
		if (message.say === "text" && index === 0) {
			return "user"
		}
		// System messages
		if (message.say === "api_req_started" || message.say === "api_req_finished") {
			return "system"
		}
		// Default: assistant
		return "assistant"
	}

	// Output messages as JSON when they arrive
	useEffect(() => {
		const messages = state.clineMessages || []

		for (let i = 0; i < messages.length; i++) {
			const message = messages[i]

			// Skip partial messages - wait for complete message
			if (message.partial) {
				continue
			}

			// Skip if we already outputted this timestamp
			if (outputtedMessages.current.has(message.ts)) {
				continue
			}

			// Filter out noisy messages in non-verbose mode
			if (!verbose) {
				if (message.say === "api_req_started" || message.say === "api_req_finished") {
					outputtedMessages.current.add(message.ts)
					continue
				}
			}

			const role = getRole(message, i)

			// Output the message as JSON
			outputJson({
				type: "message",
				timestamp: message.ts,
				role,
				messageType: message.type,
				...(message.ask && { ask: message.ask }),
				...(message.say && { say: message.say }),
				...(message.text && { text: message.text }),
				...(message.reasoning && { reasoning: message.reasoning }),
				...(message.images && message.images.length > 0 && { images: message.images }),
				...(message.files && message.files.length > 0 && { files: message.files }),
			})

			outputtedMessages.current.add(message.ts)
		}
	}, [state.clineMessages, verbose])

	// Handle task completion
	useEffect(() => {
		if (isTaskComplete() && !hasOutputtedCompletion.current) {
			hasOutputtedCompletion.current = true
			setIsComplete(true)

			const completionMsg = getCompletionMessage()
			const isError = completionMsg?.say === "error" || completionMsg?.ask === "api_req_failed"

			// Output completion status
			outputJson({
				type: "completion",
				status: isError ? "error" : "success",
				timestamp: Date.now(),
			})

			if (isError) {
				onError?.()
			} else {
				onComplete?.()
			}

			// Don't exit automatically - let the parent handle cleanup
		}
	}, [isTaskComplete, setIsComplete, onComplete, onError, getCompletionMessage])

	// Render nothing visible - all output goes to stdout as JSON
	return <Box />
}
