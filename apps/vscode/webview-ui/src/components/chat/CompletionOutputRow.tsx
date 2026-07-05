import { CheckIcon } from "lucide-react"
import { memo } from "react"
import { cn } from "@/lib/utils"
import { CopyButton } from "../common/CopyButton"
import { QuoteButtonState } from "./ChatRow"
import { MarkdownRow } from "./MarkdownRow"
import QuoteButton from "./QuoteButton"

interface CompletionOutputRowProps {
	text: string
	quoteButtonState: QuoteButtonState
	handleQuoteClick: () => void
	headClassNames?: string
}

export const CompletionOutputRow = memo(
	({ headClassNames, text, quoteButtonState, handleQuoteClick }: CompletionOutputRowProps) => {
		return (
			<div>
				<div className="rounded-sm border border-success/20 overflow-visible bg-success/10 p-2 pt-3">
					{/* Title */}
					<div className={cn(headClassNames, "justify-between px-1")}>
						<div className="flex gap-2 items-center">
							<CheckIcon className="size-3 text-success" />
							<span className="text-success font-bold">Task Completed</span>
						</div>
						<CopyButton className="text-success" textToCopy={text} />
					</div>
					{/* Content */}
					<div className="w-full relative border-t-1 border-description/20 rounded-b-sm">
						<div className="completion-output-content p-2 pt-3 w-full [&_hr]:opacity-20 [&_p:last-child]:mb-0 rounded-sm">
							<MarkdownRow markdown={text} />
							{quoteButtonState.visible && (
								<QuoteButton left={quoteButtonState.left} onClick={handleQuoteClick} top={quoteButtonState.top} />
							)}
						</div>
					</div>
				</div>
			</div>
		)
	},
)

CompletionOutputRow.displayName = "CompletionOutputRow"
