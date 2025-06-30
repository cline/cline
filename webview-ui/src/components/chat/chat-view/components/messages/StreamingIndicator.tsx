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

/**
 * Component that shows a visual streaming indicator
 * Can be used to show loading states, typing indicators, etc.
 */
export const StreamingVisualIndicator: React.FC<{ isStreaming: boolean }> = ({ isStreaming }) => {
	if (!isStreaming) return null

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				padding: "8px 16px",
				color: "var(--vscode-descriptionForeground)",
				fontSize: "12px",
			}}>
			<div
				style={{
					display: "flex",
					gap: "4px",
					marginRight: "8px",
				}}>
				{[0, 1, 2].map((i) => (
					<div
						key={i}
						style={{
							width: "4px",
							height: "4px",
							borderRadius: "50%",
							backgroundColor: "var(--vscode-progressBar-background)",
							animation: `pulse 1.4s infinite ease-in-out ${i * 0.16}s`,
						}}
					/>
				))}
			</div>
			<span>Cline is thinking...</span>
			<style>{`
				@keyframes pulse {
					0%, 80%, 100% {
						opacity: 0.3;
						transform: scale(0.8);
					}
					40% {
						opacity: 1;
						transform: scale(1);
					}
				}
			`}</style>
		</div>
	)
}
