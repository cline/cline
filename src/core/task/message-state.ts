import Anthropic from "@anthropic-ai/sdk"
import CheckpointTracker from "@integrations/checkpoints/CheckpointTracker"
import getFolderSize from "get-folder-size"
import { findLastIndex } from "@/shared/array"
import { combineApiRequests } from "@/shared/combineApiRequests"
import { combineCommandSequences } from "@/shared/combineCommandSequences"
import { AiHydroMessage } from "@/shared/ExtensionMessage"
import { getApiMetrics } from "@/shared/getApiMetrics"
import { HistoryItem } from "@/shared/HistoryItem"
import { getCwd, getDesktopDir } from "@/utils/path"
import { ensureTaskDirectoryExists, saveAiHydroMessages, saveApiConversationHistory } from "../storage/disk"
import { TaskState } from "./TaskState"

interface MessageStateHandlerParams {
	taskId: string
	ulid: string
	taskIsFavorited?: boolean
	updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	taskState: TaskState
	checkpointManagerErrorMessage?: string
}

export class MessageStateHandler {
	private apiConversationHistory: Anthropic.MessageParam[] = []
	private aihydroMessages: AiHydroMessage[] = []
	private taskIsFavorited: boolean
	private checkpointTracker: CheckpointTracker | undefined
	private updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	private taskId: string
	private ulid: string
	private taskState: TaskState

	constructor(params: MessageStateHandlerParams) {
		this.taskId = params.taskId
		this.ulid = params.ulid
		this.taskState = params.taskState
		this.taskIsFavorited = params.taskIsFavorited ?? false
		this.updateTaskHistory = params.updateTaskHistory
	}

	setCheckpointTracker(tracker: CheckpointTracker | undefined) {
		this.checkpointTracker = tracker
	}

	getApiConversationHistory(): Anthropic.MessageParam[] {
		return this.apiConversationHistory
	}

	setApiConversationHistory(newHistory: Anthropic.MessageParam[]): void {
		this.apiConversationHistory = newHistory
	}

	getAiHydroMessages(): AiHydroMessage[] {
		return this.aihydroMessages
	}

	setAiHydroMessages(newMessages: AiHydroMessage[]) {
		this.aihydroMessages = newMessages
	}

	async saveAiHydroMessagesAndUpdateHistory(): Promise<void> {
		try {
			await saveAiHydroMessages(this.taskId, this.aihydroMessages)

			// combined as they are in ChatView
			const apiMetrics = getApiMetrics(combineApiRequests(combineCommandSequences(this.aihydroMessages.slice(1))))
			const taskMessage = this.aihydroMessages[0] // first message is always the task say
			const lastRelevantMessage =
				this.aihydroMessages[
					findLastIndex(
						this.aihydroMessages,
						(message) => !(message.ask === "resume_task" || message.ask === "resume_completed_task"),
					)
				]
			const taskDir = await ensureTaskDirectoryExists(this.taskId)
			let taskDirSize = 0
			try {
				// getFolderSize.loose silently ignores errors
				// returns # of bytes, size/1000/1000 = MB
				taskDirSize = await getFolderSize.loose(taskDir)
			} catch (error) {
				console.error("Failed to get task directory size:", taskDir, error)
			}
			const cwd = await getCwd(getDesktopDir())
			await this.updateTaskHistory({
				id: this.taskId,
				ulid: this.ulid,
				ts: lastRelevantMessage.ts,
				task: taskMessage.text ?? "",
				tokensIn: apiMetrics.totalTokensIn,
				tokensOut: apiMetrics.totalTokensOut,
				cacheWrites: apiMetrics.totalCacheWrites,
				cacheReads: apiMetrics.totalCacheReads,
				totalCost: apiMetrics.totalCost,
				size: taskDirSize,
				shadowGitConfigWorkTree: await this.checkpointTracker?.getShadowGitConfigWorkTree(),
				cwdOnTaskInitialization: cwd,
				conversationHistoryDeletedRange: this.taskState.conversationHistoryDeletedRange,
				isFavorited: this.taskIsFavorited,
				checkpointManagerErrorMessage: this.taskState.checkpointManagerErrorMessage,
			})
		} catch (error) {
			console.error("Failed to save AI-Hydro messages:", error)
		}
	}

	async addToApiConversationHistory(message: Anthropic.MessageParam) {
		this.apiConversationHistory.push(message)
		try {
			await saveApiConversationHistory(this.taskId, this.apiConversationHistory)
		} catch (error) {
			console.error("Failed to serialize/save API conversation history:", error)
		}
	}

	async overwriteApiConversationHistory(newHistory: Anthropic.MessageParam[]): Promise<void> {
		this.apiConversationHistory = newHistory
		try {
			await saveApiConversationHistory(this.taskId, this.apiConversationHistory)
		} catch (error) {
			console.error("Failed to serialize/save API conversation history:", error)
		}
	}

	async addToAiHydroMessages(message: AiHydroMessage) {
		// these values allow us to reconstruct the conversation history at the time this AI-Hydro message was created
		// it's important that apiConversationHistory is initialized before we add AI-Hydro messages
		message.conversationHistoryIndex = this.apiConversationHistory.length - 1 // NOTE: this is the index of the last added message which is the user message, and once the clinemessages have been presented we update the apiconversationhistory with the completed assistant message. This means when resetting to a message, we need to +1 this index to get the correct assistant message that this tool use corresponds to
		message.conversationHistoryDeletedRange = this.taskState.conversationHistoryDeletedRange
		this.aihydroMessages.push(message)
		await this.saveAiHydroMessagesAndUpdateHistory()
	}

	async overwriteAiHydroMessages(newMessages: AiHydroMessage[]) {
		this.aihydroMessages = newMessages
		await this.saveAiHydroMessagesAndUpdateHistory()
	}

	async updateAiHydroMessage(index: number, updates: Partial<AiHydroMessage>): Promise<void> {
		if (index < 0 || index >= this.aihydroMessages.length) {
			throw new Error(`Invalid message index: ${index}`)
		}

		// Apply updates to the message
		Object.assign(this.aihydroMessages[index], updates)

		// Save changes and update history
		await this.saveAiHydroMessagesAndUpdateHistory()
	}
}
