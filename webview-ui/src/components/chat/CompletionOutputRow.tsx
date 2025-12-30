import { memo } from "react"
import { cn } from "@/lib/utils"
import { MarkdownRow } from "./MarkdownRow"
import "./CompletionOutputRow.css"
import { QuoteButtonState } from "./ChatRow"
import ExpandHandle from "./ExpandHandle"
import QuoteButton from "./QuoteButton"

export const CompletionOutputRow = memo(
	({
		text,
		isOutputFullyExpanded,
		onToggle,
		quoteButtonState,
		handleQuoteClick,
	}: {
		text: string
		isOutputFullyExpanded: boolean
		onToggle: () => void
		quoteButtonState: QuoteButtonState
		handleQuoteClick: () => void
	}) => {
		const outputLines = text.split("\n")
		const lineCount = outputLines.length
		const shouldAutoShow = lineCount <= 5

		return (
			<div
				className={cn("w-full relative pb-0 overflow-visible border-t-1 border-description/20 rounded-b-sm", {
					"pb-2": !shouldAutoShow,
				})}>
				<div
					className={cn("completion-output-content", "scroll-smooth p-2 overflow-y-auto w-full", {
						"max-h-[400px]": !shouldAutoShow && isOutputFullyExpanded,
						"max-h-[150px]": !shouldAutoShow && !isOutputFullyExpanded,
						"overflow-y-visible": shouldAutoShow,
					})}>
					<MarkdownRow markdown={text} />
					{quoteButtonState.visible && (
						<QuoteButton left={quoteButtonState.left} onClick={handleQuoteClick} top={quoteButtonState.top} />
					)}
				</div>
				{/* Show notch only if there's more than 5 lines */}
				{!shouldAutoShow ? (
					<ExpandHandle className="bg-success -bottom-4" isExpanded={isOutputFullyExpanded} onToggle={onToggle} />
				) : null}
			</div>
		)
	},
)

CompletionOutputRow.displayName = "CompletionOutputRow"
