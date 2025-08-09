import { findLast } from "@shared/array"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { useMemo } from "react"

/**
 * Hook to determine if the chat is currently streaming
 * Encapsulates the complex streaming detection logic
 */
export const useIsStreaming = (modifiedMessages: ClineMessage[], clineAsk?: string, task?: ClineMessage): boolean => {
	return useMemo(() => {
		// Check if the last message is an ask (tool is waiting for user input)
		const isLastAsk = !!modifiedMessages.at(-1)?.ask
		const isCommandAsk = clineAsk === "command"
		const isToolCurrentlyAsking = isLastAsk && clineAsk !== undefined
		if (!task?.ask) {
			return false
		}
		if (isToolCurrentlyAsking && isCommandAsk) {
			return false
		}

		// Check if the last message is partial (still being streamed)
		const isLastMessagePartial = modifiedMessages.at(-1)?.partial === true
		if (isLastMessagePartial) {
			return true
		}

		// Check if there's an ongoing API request
		const lastApiReqStarted = findLast(modifiedMessages, (message) => message.say === "api_req_started")
		if (lastApiReqStarted && lastApiReqStarted.text != null && lastApiReqStarted.say === "api_req_started") {
			const cost = JSON.parse(lastApiReqStarted.text).cost
			if (cost === undefined) {
				// API request has not finished yet
				return true
			}
		}

		return false
	}, [modifiedMessages, clineAsk, task?.ask])
}
