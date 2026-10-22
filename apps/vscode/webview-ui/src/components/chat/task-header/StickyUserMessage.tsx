import type { ClineMessage } from "@shared/ExtensionMessage"
import { memo, useId, useState } from "react"
import { highlightText } from "./Highlights"

interface StickyUserMessageProps {
	readonly lastUserMessage: ClineMessage | null
	readonly onScrollToMessage?: () => void
	readonly isVisible: boolean
}

export const StickyUserMessage = memo(({ lastUserMessage, onScrollToMessage, isVisible }: StickyUserMessageProps) => {
	const [expanded, setExpanded] = useState(false)
	const previewId = useId()
	if (!lastUserMessage || !isVisible) return null
	const text = lastUserMessage.text?.trim() || "[Attachments]"
	return (
		<section
			aria-label="Latest submitted prompt"
			className="min-h-0 flex flex-col rounded-sm bg-badge text-badge-foreground mb-2 p-2">
			<div className="flex shrink-0 justify-between gap-2 text-xs mb-1">
				<button aria-controls={previewId} aria-expanded={expanded} onClick={() => setExpanded(!expanded)} type="button">
					{expanded ? "Collapse prompt" : "Expand prompt"}
				</button>
				<button onClick={onScrollToMessage} type="button">
					Jump to original
				</button>
			</div>
			<div className="min-h-0 overflow-y-auto" id={previewId}>
				<div
					className={`ph-no-capture whitespace-pre-wrap wrap-anywhere select-text text-sm ${expanded ? "" : "line-clamp-3"}`}>
					{highlightText(text, false)}
				</div>
			</div>
		</section>
	)
})
StickyUserMessage.displayName = "StickyUserMessage"
