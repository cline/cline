import { memo } from "react"
import { cn } from "@/lib/utils"
import { MarkdownRow } from "./MarkdownRow"
import "./CompletionOutputRow.css"
import { Int64Request } from "@shared/proto/cline/common"
import { CheckIcon } from "lucide-react"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { TaskServiceClient } from "@/services/grpc-client"
import { CopyButton } from "../common/CopyButton"
import SuccessButton from "../common/SuccessButton"
import { QuoteButtonState } from "./ChatRow"
import QuoteButton from "./QuoteButton"

interface CompletionOutputRowProps {
	text: string
	quoteButtonState: QuoteButtonState
	handleQuoteClick: () => void
	headClassNames?: string
	showActionRow?: boolean
	seeNewChangesDisabled: boolean
	setSeeNewChangesDisabled: (value: boolean) => void
	explainChangesDisabled: boolean
	setExplainChangesDisabled: (value: boolean) => void
	messageTs: number
}

export const CompletionOutputRow = memo(
	({
		headClassNames,
		text,
		quoteButtonState,
		showActionRow,
		seeNewChangesDisabled,
		setSeeNewChangesDisabled,
		explainChangesDisabled,
		setExplainChangesDisabled,
		messageTs,
		handleQuoteClick,
	}: CompletionOutputRowProps) => {
		const outputLines = text.split("\n")
		const lineCount = outputLines.length
		const shouldAutoShow = lineCount <= 5
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
					<div className="w-full relative overflow-hidden border-t-1 border-description/20 rounded-b-sm">
						<div
							className={cn(
								"completion-output-content",
								"scroll-smooth p-2 pt-3 overflow-y-auto w-full [&_hr]:opacity-20 [&_p:last-child]:mb-0 rounded-sm max-h-[400px]",
								{
									"overflow-y-visible": shouldAutoShow,
								},
							)}>
							<MarkdownRow markdown={text} />
							{quoteButtonState.visible && (
								<QuoteButton left={quoteButtonState.left} onClick={handleQuoteClick} top={quoteButtonState.top} />
							)}
						</div>
					</div>
				</div>
				{/* Action Buttons */}
				{showActionRow && (
					<CompletionOutputActionRow
						explainChangesDisabled={explainChangesDisabled}
						messageTs={messageTs}
						seeNewChangesDisabled={seeNewChangesDisabled}
						setExplainChangesDisabled={setExplainChangesDisabled}
						setSeeNewChangesDisabled={setSeeNewChangesDisabled}
					/>
				)}
			</div>
		)
	},
)

CompletionOutputRow.displayName = "CompletionOutputRow"

const CompletionOutputActionRow = memo(
	({
		seeNewChangesDisabled,
		setSeeNewChangesDisabled,
		explainChangesDisabled,
		setExplainChangesDisabled,
		messageTs,
	}: {
		seeNewChangesDisabled: boolean
		setSeeNewChangesDisabled: (value: boolean) => void
		explainChangesDisabled: boolean
		setExplainChangesDisabled: (value: boolean) => void
		messageTs: number
	}) => {
		return (
			<div style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
				<SuccessButton
					disabled={seeNewChangesDisabled}
					onClick={() => {
						setSeeNewChangesDisabled(true)
						TaskServiceClient.taskCompletionViewChanges(
							Int64Request.create({
								value: messageTs,
							}),
						).catch((err) => console.error("Failed to show task completion view changes:", err))
					}}
					style={{
						cursor: seeNewChangesDisabled ? "wait" : "pointer",
						width: "100%",
					}}>
					<i className="codicon codicon-new-file" style={{ marginRight: 6 }} />
					View Changes
				</SuccessButton>

				{PLATFORM_CONFIG.type === PlatformType.VSCODE && (
					<SuccessButton
						disabled={explainChangesDisabled}
						onClick={() => {
							setExplainChangesDisabled(true)
							TaskServiceClient.explainChanges({
								metadata: {},
								messageTs,
							}).catch((err) => {
								console.error("Failed to explain changes:", err)
								setExplainChangesDisabled(false)
							})
						}}
						style={{
							cursor: explainChangesDisabled ? "wait" : "pointer",
							width: "100%",
						}}>
						<i className="codicon codicon-comment-discussion" style={{ marginRight: 6 }} />
						{explainChangesDisabled ? "Explaining..." : "Explain Changes"}
					</SuccessButton>
				)}
			</div>
		)
	},
)
