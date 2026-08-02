import { ClineAskQuestion, ClineMessage, ClinePlanModeResponse, COMPLETION_RESULT_CHANGES_FLAG } from "@shared/ExtensionMessage"
import { FilePlus2Icon } from "lucide-react"
import type React from "react"
import { memo } from "react"
import { OptionsButtons } from "@/components/chat/OptionsButtons"
import { WithCopyButton } from "@/components/common/CopyButton"
import type { QuoteButtonState } from "./ChatRow"
import { CompletionOutputRow } from "./CompletionOutputRow"
import ErrorRow from "./ErrorRow"
import { MarkdownRow } from "./MarkdownRow"
import NewTaskPreview from "./NewTaskPreview"
import PlanCompletionOutputRow from "./PlanCompletionOutputRow"
import QuoteButton from "./QuoteButton"
import ReportBugPreview from "./ReportBugPreview"

const HEADER_CLASSNAMES = "flex items-center gap-2.5 mb-3"
const InvisibleSpacer = () => <div aria-hidden className="h-px" />

interface ChatAskRowProps {
	message: ClineMessage
	isLast: boolean
	lastModifiedMessage?: ClineMessage
	inputValue?: string
	icon: React.ReactNode
	title: React.ReactNode
	quoteButtonState: QuoteButtonState
	contentRef: React.RefObject<HTMLDivElement>
	handleMouseUp: (event: React.MouseEvent<HTMLDivElement>) => void
	handleQuoteClick: () => void
}

/**
 * V12 方案5 - ask-type chat row renderer, extracted from ChatRow for
 * fine-grained memoization and a smaller ChatRow surface. Renders approval
 * prompts, follow-up questions, completion results and plan-mode responses.
 */
const ChatAskRow = memo(
	({
		message,
		isLast,
		lastModifiedMessage,
		inputValue,
		icon,
		title,
		quoteButtonState,
		contentRef,
		handleMouseUp,
		handleQuoteClick,
	}: ChatAskRowProps) => {
		switch (message.ask) {
			case "mistake_limit_reached":
				return <ErrorRow errorType="mistake_limit_reached" message={message} />
			case "completion_result":
				if (message.text) {
					const hasChanges = message.text.endsWith(COMPLETION_RESULT_CHANGES_FLAG) ?? false
					const text = hasChanges ? message.text.slice(0, -COMPLETION_RESULT_CHANGES_FLAG.length) : message.text
					return (
						<CompletionOutputRow
							handleQuoteClick={handleQuoteClick}
							headClassNames={HEADER_CLASSNAMES}
							quoteButtonState={quoteButtonState}
							text={text || ""}
						/>
					)
				}
				// Virtuoso cannot handle zero-height items; render a spacer instead of null
				return <InvisibleSpacer />
			case "followup":
				let question: string | undefined
				let options: string[] | undefined
				let selected: string | undefined
				try {
					const parsedMessage = JSON.parse(message.text || "{}") as ClineAskQuestion
					question = parsedMessage.question
					options = parsedMessage.options
					selected = parsedMessage.selected
				} catch (_e) {
					// legacy messages would pass question directly
					question = message.text
				}

				return (
					<div>
						{title && (
							<div className={HEADER_CLASSNAMES}>
								{icon}
								{title}
							</div>
						)}
						<WithCopyButton
							className="pt-1"
							onMouseUp={handleMouseUp}
							position="bottom-right"
							ref={contentRef}
							textToCopy={question}>
							<MarkdownRow markdown={question} />
							{quoteButtonState.visible && (
								<QuoteButton
									left={quoteButtonState.left}
									onClick={() => {
										handleQuoteClick()
									}}
									top={quoteButtonState.top}
								/>
							)}
						</WithCopyButton>
						<div className="pt-3">
							<OptionsButtons
								inputValue={inputValue}
								isActive={
									(isLast && lastModifiedMessage?.ask === "followup") ||
									(!selected && options && options.length > 0)
								}
								options={options}
								selected={selected}
							/>
						</div>
					</div>
				)
			case "new_task":
				return (
					<div>
						<div className={HEADER_CLASSNAMES}>
							<FilePlus2Icon className="size-2" />
							<span className="text-foreground font-bold">Cline wants to start a new task:</span>
						</div>
						<NewTaskPreview context={message.text || ""} />
					</div>
				)
			case "condense":
				return (
					<div>
						<div className={HEADER_CLASSNAMES}>
							<FilePlus2Icon className="size-2" />
							<span className="text-foreground font-bold">Cline wants to condense your conversation:</span>
						</div>
						<NewTaskPreview context={message.text || ""} />
					</div>
				)
			case "report_bug":
				return (
					<div>
						<div className={HEADER_CLASSNAMES}>
							<FilePlus2Icon className="size-2" />
							<span className="text-foreground font-bold">Cline wants to create a Github issue:</span>
						</div>
						<ReportBugPreview data={message.text || ""} />
					</div>
				)
			case "plan_mode_respond": {
				let response: string | undefined
				let options: string[] | undefined
				let selected: string | undefined
				try {
					const parsedMessage = JSON.parse(message.text || "{}") as ClinePlanModeResponse
					response = parsedMessage.response
					options = parsedMessage.options
					selected = parsedMessage.selected
				} catch (_e) {
					// legacy messages would pass response directly
					response = message.text
				}
				return (
					<div>
						<PlanCompletionOutputRow headClassNames={HEADER_CLASSNAMES} text={response || message.text || ""} />
						<OptionsButtons
							inputValue={inputValue}
							isActive={
								(isLast && lastModifiedMessage?.ask === "plan_mode_respond") ||
								(!selected && options && options.length > 0)
							}
							options={options}
							selected={selected}
						/>
					</div>
				)
			}
			default:
				return <InvisibleSpacer />
		}
	},
)

export default ChatAskRow
