import { EmptyRequest } from "@shared/proto/cline/common"
import { GitCompareIcon } from "lucide-react"
import { memo, useState } from "react"
import { CheckpointsServiceClient } from "@/services/grpc-client"
import { CopyButton } from "../common/CopyButton"
import SuccessButton from "../common/SuccessButton"
import { QuoteButtonState } from "./ChatRow"
import { MarkdownRow } from "./MarkdownRow"
import QuoteButton from "./QuoteButton"

interface CompletionOutputRowProps {
	text: string
	quoteButtonState: QuoteButtonState
	handleQuoteClick: () => void
	/**
	 * Shows the "View Changes" action inside the card, which opens a
	 * multi-file diff of everything that changed between the latest checkpoint
	 * (taken when the user's last message started the run) and the current
	 * working tree. Only meaningful on the latest, finalized completion row.
	 */
	showViewChanges?: boolean
}

/**
 * Quiet visual cue that the agent's turn ended on this response (act mode):
 * a green-tinted container with a small, muted "Completed" label and a copy
 * button. Deliberately less prominent than the legacy bold "Task Completed"
 * header, since the response might be a question or an interim summary
 * rather than a definitive task completion.
 */
export const CompletionOutputRow = memo(
	({ text, quoteButtonState, handleQuoteClick, showViewChanges }: CompletionOutputRowProps) => {
		const [viewChangesPending, setViewChangesPending] = useState(false)

		return (
			<div className="rounded-sm border border-success/20 overflow-visible bg-success/10">
				<div className="flex items-center justify-between gap-2 pl-2 pr-1 pt-1 -mb-1.5">
					<span className="text-xs font-medium uppercase tracking-wider text-success/70">Completed</span>
					<CopyButton ariaLabel="Copy response" className="text-success/70" textToCopy={text} />
				</div>
				<div className="completion-output-content relative p-2 w-full [&_hr]:opacity-20 [&_p:last-child]:mb-0 rounded-sm">
					<MarkdownRow markdown={text} />
					{quoteButtonState.visible && (
						<QuoteButton left={quoteButtonState.left} onClick={handleQuoteClick} top={quoteButtonState.top} />
					)}
				</div>
				{showViewChanges && (
					<div className="px-2 pb-2">
						<SuccessButton
							className="w-full"
							disabled={viewChangesPending}
							onClick={() => {
								setViewChangesPending(true)
								CheckpointsServiceClient.checkpointViewLatestChanges(EmptyRequest.create({}))
									.catch((err) => console.error("Failed to view latest changes:", err))
									.finally(() => setViewChangesPending(false))
							}}
							style={{ cursor: viewChangesPending ? "wait" : "pointer" }}>
							<GitCompareIcon className="size-3 mr-1.5" />
							View Changes
						</SuccessButton>
					</div>
				)}
			</div>
		)
	},
)

CompletionOutputRow.displayName = "CompletionOutputRow"
