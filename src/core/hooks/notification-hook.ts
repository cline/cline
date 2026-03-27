import type { MessageStateHandler } from "@core/task/message-state"
import type { NotificationData } from "@shared/proto/cline/hooks"
import { ulid } from "ulid"
import { Logger } from "@/shared/services/Logger"
import * as HookExecutor from "./hook-executor"
import type { HookModelInputContext } from "./hook-factory"

export const NOTIFICATION_MESSAGE_MAX_LENGTH = 8000
const NOTIFICATION_EVENT_VERSION = "1"
const NOTIFICATION_SEVERITY_INFO = "info"

type NotificationExecutionContext = {
	messageStateHandler: MessageStateHandler
	taskId: string
	hooksEnabled: boolean
	model?: HookModelInputContext
}

type BaseNotificationInput = {
	event: string
	source: string
	message: string
	waitingForUserInput: boolean
	sourceType: string
	sourceId: string
	requiresUserAction: boolean
	severity?: string
	eventId?: string
}

export function buildNotificationData(input: BaseNotificationInput): NotificationData {
	const message = input.message
	const messageTruncated = message.length > NOTIFICATION_MESSAGE_MAX_LENGTH

	return {
		event: input.event,
		source: input.source,
		message: messageTruncated ? `${message.slice(0, NOTIFICATION_MESSAGE_MAX_LENGTH)}\n...[truncated]` : message,
		waitingForUserInput: input.waitingForUserInput,
		eventVersion: NOTIFICATION_EVENT_VERSION,
		eventId: input.eventId ?? ulid(),
		messageTruncated,
		sourceType: input.sourceType,
		sourceId: input.sourceId,
		requiresUserAction: input.requiresUserAction,
		severity: input.severity ?? NOTIFICATION_SEVERITY_INFO,
	}
}

export async function emitNotificationHook(context: NotificationExecutionContext, notification: NotificationData): Promise<void> {
	if (!context.hooksEnabled) {
		return
	}

	try {
		const result = await HookExecutor.executeHook({
			hookName: "Notification",
			hookInput: {
				notification,
			},
			isCancellable: false,
			say: async () => undefined,
			messageStateHandler: context.messageStateHandler,
			taskId: context.taskId,
			hooksEnabled: context.hooksEnabled,
			model: context.model,
		})

		if (result.cancel) {
			Logger.warn("[Notification Hook] Ignoring unsupported cancel output")
		}

		if (result.contextModification) {
			Logger.warn("[Notification Hook] Ignoring unsupported contextModification output")
		}
	} catch (error) {
		Logger.error("[Notification Hook] Failed (non-fatal):", error)
	}
}

export async function emitUserAttentionNotification(
	context: NotificationExecutionContext,
	input: {
		source: string
		message: string
		waitingForUserInput?: boolean
		requiresUserAction?: boolean
	},
): Promise<void> {
	const notification = buildNotificationData({
		event: "user_attention",
		source: input.source,
		sourceType: "ask",
		sourceId: input.source,
		message: input.message,
		waitingForUserInput: input.waitingForUserInput ?? true,
		requiresUserAction: input.requiresUserAction ?? true,
		severity: NOTIFICATION_SEVERITY_INFO,
	})

	await emitNotificationHook(context, notification)
}

export async function emitTaskCompleteNotification(
	context: NotificationExecutionContext,
	input: {
		message: string
	},
): Promise<void> {
	const notification = buildNotificationData({
		event: "task_complete",
		source: "attempt_completion",
		sourceType: "tool",
		sourceId: "attempt_completion",
		message: input.message,
		waitingForUserInput: false,
		requiresUserAction: false,
		severity: NOTIFICATION_SEVERITY_INFO,
	})

	await emitNotificationHook(context, notification)
}
