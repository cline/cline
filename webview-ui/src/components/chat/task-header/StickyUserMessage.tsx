import { ClineMessage } from "@shared/ExtensionMessage"
import React, { memo } from "react"
import { cn } from "@/lib/utils"
import { highlightText } from "./Highlights"

interface StickyUserMessageProps {
	readonly lastUserMessage: ClineMessage | null
	readonly onScrollToMessage?: () => void
	readonly isVisible: boolean
}

export const StickyUserMessage: React.FC<StickyUserMessageProps> = memo(
	({ lastUserMessage, onScrollToMessage, isVisible }) => {
		if (!lastUserMessage?.text || !isVisible) {
			return null
		}

		const messageText = lastUserMessage.text.trim()

		return (
			<button
				aria-label={`Scroll to your message: ${messageText}`}
				className={cn(
					"relative flex items-center px-2.5 pt-2 pb-2 cursor-pointer select-none w-full border-0",
					"backdrop-blur-sm",
					"hover:brightness-110",
				)}
				onClick={onScrollToMessage}
				style={{
					backgroundColor: "var(--vscode-badge-background)",
					borderRadius: "3px",
				}}
				title="Click to scroll to your message"
				type="button">
				<div
					className={cn(
						"flex-1 min-w-0 text-sm text-badge-foreground",
						"overflow-hidden text-ellipsis whitespace-nowrap",
						"ph-no-capture",
					)}>
					{highlightText(messageText, false)}
				</div>
			</button>
		)
	},
	(prevProps, nextProps) =>
		prevProps.lastUserMessage?.ts === nextProps.lastUserMessage?.ts &&
		prevProps.lastUserMessage?.text === nextProps.lastUserMessage?.text &&
		prevProps.isVisible === nextProps.isVisible,
)

StickyUserMessage.displayName = "StickyUserMessage"
