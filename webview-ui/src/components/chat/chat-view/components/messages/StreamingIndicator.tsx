import React, { useMemo } from "react"
import { ClineMessage } from "@shared/ExtensionMessage"
import { findLast } from "@shared/array"

/**
 * Hook to determine if the chat is currently streaming
 * Encapsulates the complex streaming detection logic
 */
export const useIsStreaming = (
	modifiedMessages: ClineMessage[],
	clineAsk?: string,
	enableButtons?: boolean,
	primaryButtonText?: string,
): boolean => {
	return useMemo(() => {
		// Check if the last message is an ask (tool is waiting for user input)
		const isLastAsk = !!modifiedMessages.at(-1)?.ask
		const isToolCurrentlyAsking = isLastAsk && clineAsk !== undefined && enableButtons && primaryButtonText !== undefined
		if (isToolCurrentlyAsking) {
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
	}, [modifiedMessages, clineAsk, enableButtons, primaryButtonText])
}
