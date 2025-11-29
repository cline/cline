import { ClineMessage } from "@shared/ExtensionMessage"
import React, { memo, useCallback } from "react"
import { cn } from "@/lib/utils"
import { highlightText } from "./Highlights"

interface StickyUserMessageProps {
	readonly lastUserMessage: ClineMessage | null
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

		const handleKeyDown = useCallback(
			(e: React.KeyboardEvent) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault()
					if (onScrollToMessage) {
						onScrollToMessage()
					}
				}
			},
			[onScrollToMessage],
		)

		// Don't render if no user message or not visible
		if (!lastUserMessage?.text || !isVisible) {
			return null
		}

		const messageText = lastUserMessage.text.trim()

		return (
			<div
				aria-label={`Scroll to your message: ${messageText}`}
				className={cn(
					"relative flex items-center px-2.5 pt-2 pb-2 cursor-pointer select-none",
					"backdrop-blur-sm",
					"hover:brightness-110",
				)}
				onClick={handleClick}
				onKeyDown={handleKeyDown}
				role="button"
				style={{
					backgroundColor: "var(--vscode-badge-background)",
					borderRadius: "3px",
				}}
				tabIndex={0}
				title="Click to scroll to your message">
				{/* Message text (truncated via CSS text-ellipsis) */}
				<div
					className={cn(
						"flex-1 min-w-0 text-sm text-badge-foreground",
						"overflow-hidden text-ellipsis whitespace-nowrap",
						"ph-no-capture",
					)}>
					{highlightText(messageText, false)}
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
