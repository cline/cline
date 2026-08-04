import { memo } from "react"
import { QuoteButtonState } from "./ChatRow"
import { MarkdownRow } from "./MarkdownRow"
import QuoteButton from "./QuoteButton"

interface CompletionOutputRowProps {
	text: string
	quoteButtonState: QuoteButtonState
	handleQuoteClick: () => void
}

/**
 * Quiet visual cue that the agent's turn ended on this response (act mode):
 * a green-tinted container with no header or label. The response might be a
 * question or an interim summary rather than a definitive task completion,
 * so the box deliberately makes no "Task Completed" claim.
 */
export const CompletionOutputRow = memo(({ text, quoteButtonState, handleQuoteClick }: CompletionOutputRowProps) => {
	return (
		<div className="rounded-sm border border-success/20 overflow-visible bg-success/10">
			<div className="completion-output-content relative p-2 w-full [&_hr]:opacity-20 [&_p:last-child]:mb-0 rounded-sm">
				<MarkdownRow markdown={text} />
				{quoteButtonState.visible && (
					<QuoteButton left={quoteButtonState.left} onClick={handleQuoteClick} top={quoteButtonState.top} />
				)}
			</div>
		</div>
	)
})

CompletionOutputRow.displayName = "CompletionOutputRow"
