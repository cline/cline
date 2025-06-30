import React from "react"
import TaskHeader from "@/components/chat/task-header/TaskHeader"
import { ClineMessage } from "@shared/ExtensionMessage"
import { MessageHandlers, ScrollBehavior } from "../../types/chatTypes"

interface TaskSectionProps {
	task: ClineMessage
	apiMetrics: {
		totalTokensIn: number
		totalTokensOut: number
		totalCacheWrites?: number
		totalCacheReads?: number
		totalCost: number
	}
	lastApiReqTotalTokens?: number
	selectedModelInfo: {
		supportsPromptCache: boolean
		supportsImages: boolean
	}
	messageHandlers: MessageHandlers
	scrollBehavior: ScrollBehavior
}

/**
 * Task section shown when there's an active task
 * Includes the task header and manages task-specific UI
 */
export const TaskSection: React.FC<TaskSectionProps> = ({
	task,
	apiMetrics,
	lastApiReqTotalTokens,
	selectedModelInfo,
	messageHandlers,
	scrollBehavior,
}) => {
	return (
		<TaskHeader
			task={task}
			tokensIn={apiMetrics.totalTokensIn}
			tokensOut={apiMetrics.totalTokensOut}
			doesModelSupportPromptCache={selectedModelInfo.supportsPromptCache}
			cacheWrites={apiMetrics.totalCacheWrites}
			cacheReads={apiMetrics.totalCacheReads}
			totalCost={apiMetrics.totalCost}
			lastApiReqTotalTokens={lastApiReqTotalTokens}
			onClose={messageHandlers.handleTaskCloseButtonClick}
			onScrollToMessage={scrollBehavior.scrollToMessage}
		/>
	)
}
