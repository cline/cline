import { ProviderSettings, ClineMessage, GlobalState, TelemetryEventName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"
import { supportPrompt } from "../../shared/support-prompt"
import { singleCompletionHandler } from "../../utils/single-completion-handler"
import { ProviderSettingsManager } from "../config/ProviderSettingsManager"
import { ClineProvider } from "./ClineProvider"

export interface MessageEnhancerOptions {
	text: string
	apiConfiguration: ProviderSettings
	customSupportPrompts?: Record<string, any>
	listApiConfigMeta: Array<{ id: string; name?: string }>
	enhancementApiConfigId?: string
	includeTaskHistoryInEnhance?: boolean
	currentClineMessages?: ClineMessage[]
	providerSettingsManager: ProviderSettingsManager
}

export interface MessageEnhancerResult {
	success: boolean
	enhancedText?: string
	error?: string
}

/**
 * Enhances a message prompt using AI, optionally including task history for context
 */
export class MessageEnhancer {
	/**
	 * Enhances a message prompt using the configured AI provider
	 * @param options Configuration options for message enhancement
	 * @returns Enhanced message result with success status
	 */
	static async enhanceMessage(options: MessageEnhancerOptions): Promise<MessageEnhancerResult> {
		try {
			const {
				text,
				apiConfiguration,
				customSupportPrompts,
				listApiConfigMeta,
				enhancementApiConfigId,
				includeTaskHistoryInEnhance,
				currentClineMessages,
				providerSettingsManager,
			} = options

			// Determine which API configuration to use
			let configToUse: ProviderSettings = apiConfiguration

			// Try to get enhancement config first, fall back to current config
			if (enhancementApiConfigId && listApiConfigMeta.find(({ id }) => id === enhancementApiConfigId)) {
				const { name: _, ...providerSettings } = await providerSettingsManager.getProfile({
					id: enhancementApiConfigId,
				})

				if (providerSettings.apiProvider) {
					configToUse = providerSettings
				}
			}

			// Prepare the prompt to enhance
			let promptToEnhance = text

			// Include task history if enabled and available
			if (includeTaskHistoryInEnhance && currentClineMessages && currentClineMessages.length > 0) {
				const taskHistory = this.extractTaskHistory(currentClineMessages)
				if (taskHistory) {
					promptToEnhance = `${text}\n\nUse the following previous conversation context as needed:\n${taskHistory}`
				}
			}

			// Create the enhancement prompt using the support prompt system
			const enhancementPrompt = supportPrompt.create(
				"ENHANCE",
				{ userInput: promptToEnhance },
				customSupportPrompts,
			)

			// Call the single completion handler to get the enhanced prompt
			const enhancedText = await singleCompletionHandler(configToUse, enhancementPrompt)

			return {
				success: true,
				enhancedText,
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Extracts relevant task history from Cline messages for context
	 * @param messages Array of Cline messages
	 * @returns Formatted task history string
	 */
	private static extractTaskHistory(messages: ClineMessage[]): string {
		try {
			const relevantMessages = messages
				.filter((msg) => {
					// Include user messages (type: "ask" with text) and assistant messages (type: "say" with say: "text")
					if (msg.type === "ask" && msg.text) {
						return true
					}
					if (msg.type === "say" && msg.say === "text" && msg.text) {
						return true
					}
					return false
				})
				.slice(-10) // Limit to last 10 messages to avoid context explosion

			return relevantMessages
				.map((msg) => {
					const role = msg.type === "ask" ? "User" : "Assistant"
					const content = msg.text || ""
					// Truncate long messages
					return `${role}: ${content.slice(0, 500)}${content.length > 500 ? "..." : ""}`
				})
				.join("\n")
		} catch (error) {
			// Log error but don't fail the enhancement
			console.error("Failed to extract task history:", error)
			return ""
		}
	}

	/**
	 * Captures telemetry for prompt enhancement
	 * @param taskId Optional task ID for telemetry tracking
	 * @param includeTaskHistory Whether task history was included in the enhancement
	 */
	static captureTelemetry(taskId?: string, includeTaskHistory?: boolean): void {
		if (TelemetryService.hasInstance()) {
			// Use captureEvent directly to include the includeTaskHistory property
			TelemetryService.instance.captureEvent(TelemetryEventName.PROMPT_ENHANCED, {
				...(taskId && { taskId }),
				includeTaskHistory: includeTaskHistory ?? false,
			})
		}
	}
}
