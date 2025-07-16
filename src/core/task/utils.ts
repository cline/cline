import { showSystemNotification } from "@/integrations/notifications"
import { ClineApiReqCancelReason, ClineApiReqInfo } from "@/shared/ExtensionMessage"
import { serializeError } from "serialize-error"
import { MessageStateHandler } from "./message-state"
import { calculateApiCostAnthropic } from "@/utils/cost"
import { ApiHandler } from "@/api"

export function formatErrorWithStatusCode(error: any): string {
	const { statusCode, message } = extractErrorDetails(error)

	// Only prepend the statusCode if it's not already part of the message
	return statusCode && !message.includes(statusCode.toString()) ? `${statusCode} - ${message}` : message
}

export function extractErrorDetails(error: any): { message: string; statusCode?: number; requestId?: string } {
	const statusCode = error.status || error.statusCode || (error.response && error.response?.status)
	const message = error.message ?? JSON.stringify(serializeError(error), null, 2)
	const requestId = error.request_id || error.response?.request_id || undefined

	return { message, statusCode, requestId }
}

export const showNotificationForApprovalIfAutoApprovalEnabled = (
	message: string,
	autoApprovalSettingsEnabled: boolean,
	notificationsEnabled: boolean,
) => {
	if (autoApprovalSettingsEnabled && notificationsEnabled) {
		showSystemNotification({
			subtitle: "Approval Required",
			message,
		})
	}
}

type UpdateApiReqMsgParams = {
	messageStateHandler: MessageStateHandler
	lastApiReqIndex: number
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	totalCost?: number
	api: ApiHandler
	cancelReason?: ClineApiReqCancelReason
	streamingFailedMessage?: string
}

// update api_req_started. we can't use api_req_finished anymore since it's a unique case where it could come after a streaming message (ie in the middle of being updated or executed)
// fortunately api_req_finished was always parsed out for the gui anyways, so it remains solely for legacy purposes to keep track of prices in tasks from history
// (it's worth removing a few months from now)
export const updateApiReqMsg = async (params: UpdateApiReqMsgParams) => {
	const clineMessages = params.messageStateHandler.getClineMessages()
	const currentApiReqInfo: ClineApiReqInfo = JSON.parse(clineMessages[params.lastApiReqIndex].text || "{}")
	delete currentApiReqInfo.retryStatus // Clear retry status when request is finalized

	await params.messageStateHandler.updateClineMessage(params.lastApiReqIndex, {
		text: JSON.stringify({
			...currentApiReqInfo, // Spread the modified info (with retryStatus removed)
			tokensIn: params.inputTokens,
			tokensOut: params.outputTokens,
			cacheWrites: params.cacheWriteTokens,
			cacheReads: params.cacheReadTokens,
			cost:
				params.totalCost ??
				calculateApiCostAnthropic(
					params.api.getModel().info,
					params.inputTokens,
					params.outputTokens,
					params.cacheWriteTokens,
					params.cacheReadTokens,
				),
			cancelReason: params.cancelReason,
			streamingFailedMessage: params.streamingFailedMessage,
		} satisfies ClineApiReqInfo),
	})
}
