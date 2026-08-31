import { ClineMessage } from "@shared/ExtensionMessage"
import React from "react"
import TaskHeader from "@/components/chat/task-header/TaskHeader"
import { MessageHandlers } from "../../types/chatTypes"

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
}) => {
	return (
		<TaskHeader
			cacheReads={apiMetrics.totalCacheReads}
			cacheWrites={apiMetrics.totalCacheWrites}
			doesModelSupportPromptCache={selectedModelInfo.supportsPromptCache}
			lastApiReqTotalTokens={lastApiReqTotalTokens}
			onClose={messageHandlers.handleTaskCloseButtonClick}
			onSendMessage={messageHandlers.handleSendMessage}
			task={task}
			tokensIn={apiMetrics.totalTokensIn}
			tokensOut={apiMetrics.totalTokensOut}
			totalCost={apiMetrics.totalCost}
		/>
	)
}
