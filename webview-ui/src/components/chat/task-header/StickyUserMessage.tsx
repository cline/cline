import { ClineMessage } from "@shared/ExtensionMessage"
import React, { memo, useCallback } from "react"
import { cn } from "@/lib/utils"
import { highlightText } from "./Highlights"

interface StickyUserMessageProps {
	readonly lastUserMessage?: ClineMessage
	readonly onScrollToMessage?: () => void
	readonly isVisible: boolean
}

/**
 * A sticky header component that displays the last user message
 * Shows when user scrolls down, allowing quick navigation back to their message
 */
export const StickyUserMessage: React.FC<StickyUserMessageProps> = memo(
	({ lastUserMessage, onScrollToMessage, isVisible }) => {
		const handleClick = useCallback(() => {
			if (onScrollToMessage) {
				onScrollToMessage()
			}
		}, [onScrollToMessage])

		// Don't render if no user message or not visible
		if (!lastUserMessage?.text || !isVisible) {
			return null
		}

		const truncatedText = lastUserMessage.text.trim()

		return (
			<div
				className={cn("relative flex items-center px-2.5 pt-2 pb-2 cursor-pointer select-none", "backdrop-blur-sm")}
				onClick={handleClick}
				onMouseEnter={(e) => {
					e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--vscode-badge-background) 90%, white 10%)"
				}}
				onMouseLeave={(e) => {
					e.currentTarget.style.backgroundColor = "var(--vscode-badge-background)"
				}}
				style={{
					backgroundColor: "var(--vscode-badge-background)",
					borderRadius: "3px",
				}}
				title="Click to scroll to your message">
				{/* Truncated message text */}
				<div
					className={cn(
						"flex-1 min-w-0 text-sm text-badge-foreground",
						"overflow-hidden text-ellipsis whitespace-nowrap",
						"ph-no-capture",
					)}>
					{highlightText(truncatedText, false)}
				</div>
			</div>
		)
	},
	(prevProps, nextProps) => {
		return (
			prevProps.lastUserMessage?.ts === nextProps.lastUserMessage?.ts &&
			prevProps.lastUserMessage?.text === nextProps.lastUserMessage?.text &&
			prevProps.isVisible === nextProps.isVisible
		)
	},
)

StickyUserMessage.displayName = "StickyUserMessage"
