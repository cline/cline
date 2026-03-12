import type { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import type React from "react"
import { useMemo } from "react"
import { getIconByToolName } from "./chat-view"
import ErrorRow from "./ErrorRow"
import { getRequestStartRowState } from "./requestStartRowState"
import { ThinkingRow } from "./ThinkingRow"
import { TypewriterText } from "./TypewriterText"

interface RequestStartRowProps {
	message: ClineMessage
	apiRequestFailedMessage?: string
	apiReqStreamingFailedMessage?: string
	cost?: number
	reasoningContent?: string
	responseStarted?: boolean
	clineMessages: ClineMessage[]
	mode?: Mode
	classNames?: string
	isExpanded: boolean
	handleToggle: () => void
}

/**
 * Displays the current state of an active tool operation,
 */
export const RequestStartRow: React.FC<RequestStartRowProps> = ({
	apiRequestFailedMessage,
	apiReqStreamingFailedMessage,
	cost,
	reasoningContent,
	responseStarted,
	clineMessages,
	mode,
	handleToggle,
	isExpanded,
	message,
}) => {
	const { apiReqState, currentActivities, shouldShowActivities } = useMemo(
		() =>
			getRequestStartRowState({
				message,
				clineMessages,
				reasoningContent,
				apiRequestFailedMessage,
				apiReqStreamingFailedMessage,
				cost,
				responseStarted,
				getIconByToolName: (toolName) => getIconByToolName(toolName as ClineSayTool["tool"]),
			}),
		[message, clineMessages, reasoningContent, apiRequestFailedMessage, apiReqStreamingFailedMessage, cost, responseStarted],
	)
	const hasCost = cost != null

	// Initial loading ("Thinking..." before any content) is injected as a synthetic in-list
	// reasoning row in MessagesArea to avoid footer handoff flicker.

	return (
		<div>
			{apiReqState === "pre" && shouldShowActivities && (
				<div className="flex items-center text-description w-full text-sm">
					<div className="ml-1 flex-1 w-full h-full">
						<div className="flex flex-col gap-0.5 w-full min-h-1">
							{currentActivities.map((activity, _) => (
								<div className="flex items-center gap-2 h-auto w-full overflow-hidden" key={activity.text}>
									<activity.icon className="size-2 text-foreground shrink-0" />
									<TypewriterText speed={15} text={activity.text} />
								</div>
							))}
						</div>
					</div>
				</div>
			)}
			{reasoningContent &&
				(!hasCost ? (
					// Still streaming - show "Thinking..." text with shimmer
					<div className="ml-1 pl-0 mb-1 -mt-1.25 pt-1">
						<div className="inline-flex justify-baseline gap-0.5 text-left select-none px-0 w-full">
							<span className="animate-shimmer bg-linear-90 from-foreground to-description bg-[length:200%_100%] bg-clip-text text-transparent text-[13px] leading-none">
								Thinking...
							</span>
						</div>
					</div>
				) : (
					// Complete - always show collapsible thinking section
					<ThinkingRow
						isExpanded={isExpanded}
						isVisible={true}
						onToggle={handleToggle}
						reasoningContent={reasoningContent}
						showTitle={true}
					/>
				))}

			{apiReqState === "error" && (
				<ErrorRow
					apiReqStreamingFailedMessage={apiReqStreamingFailedMessage}
					apiRequestFailedMessage={apiRequestFailedMessage}
					errorType="error"
					message={message}
				/>
			)}
		</div>
	)
}
