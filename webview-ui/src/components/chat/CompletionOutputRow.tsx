import { memo } from "react"
import { cn } from "@/lib/utils"
import { MarkdownRow } from "./MarkdownRow"
import "./CompletionOutputRow.css"
import { Int64Request } from "@shared/proto/cline/common"
import { CheckIcon, FilePlus2Icon, MessageSquareTextIcon } from "lucide-react"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { TaskServiceClient } from "@/services/grpc-client"
import { CopyButton } from "../common/CopyButton"
import { Button } from "../ui/button"
import { QuoteButtonState } from "./ChatRow"
import ExpandHandle from "./ExpandHandle"
import QuoteButton from "./QuoteButton"

interface CompletionOutputRowProps {
	text: string
	isOutputFullyExpanded: boolean
	onToggle: () => void
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
		isOutputFullyExpanded,
		onToggle,
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
			<div className="rounded-sm border border-success/20">
				<div className="rounded-sm border border-success/20 overflow-visible bg-success/10 transition-border duration-300 ease-in-out hover:border-success p-2">
					{/* Title */}
					<div className={cn(headClassNames, "justify-between")}>
						<div className="flex gap-2 items-center">
							<CheckIcon className="size-3 text-success" />
							<span className="text-success font-bold">Task Completed</span>
						</div>
						<CopyButton textToCopy={text} />
					</div>
					{/* Content */}
					<div
						className={cn("w-full relative pb-0 overflow-visible border-t-1 border-description/20 rounded-b-sm", {
							"pb-2": !shouldAutoShow,
						})}>
						<div
							className={cn(
								"completion-output-content",
								"scroll-smooth p-2 overflow-y-auto w-full [&_hr]:opacity-20 rounded-sm",
								{
									"max-h-[400px]": !shouldAutoShow && isOutputFullyExpanded,
									"max-h-[150px]": !shouldAutoShow && !isOutputFullyExpanded,
									"overflow-y-visible": shouldAutoShow,
								},
							)}>
							<MarkdownRow markdown={text} />
							{quoteButtonState.visible && (
								<QuoteButton left={quoteButtonState.left} onClick={handleQuoteClick} top={quoteButtonState.top} />
							)}
						</div>
						{/* Show notch only if there's more than 5 lines */}
						{!shouldAutoShow ? (
							<ExpandHandle
								className="bg-success -bottom-4"
								isExpanded={isOutputFullyExpanded}
								onToggle={onToggle}
							/>
						) : null}
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

const ACTION_BUTTON_CLASSNAMES =
	"flex-1 border border-editor-group-border rounded-xs px-3 py-2 flex items-center justify-center transition-border duration-200 ease-in-out disabled:cursor-wait py-2"

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
			<div className="mt-4 flex flex-row gap-2">
				<Button
					className={cn(ACTION_BUTTON_CLASSNAMES)}
					disabled={seeNewChangesDisabled}
					onClick={() => {
						setSeeNewChangesDisabled(true)
						TaskServiceClient.taskCompletionViewChanges(
							Int64Request.create({
								value: messageTs,
							}),
						).catch((err) => console.error("Failed to show task completion view changes:", err))
					}}
					variant="success">
					<FilePlus2Icon className="size-2" />
					View Changes
				</Button>

				{PLATFORM_CONFIG.type === PlatformType.VSCODE && (
					<Button
						className={cn(ACTION_BUTTON_CLASSNAMES)}
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
						variant="success">
						<MessageSquareTextIcon className="size-2" />
						{explainChangesDisabled ? "Explaining..." : "Explain Changes"}
					</Button>
				)}
			</div>
		)
	},
)
