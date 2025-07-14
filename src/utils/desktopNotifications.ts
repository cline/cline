import * as notifier from "node-notifier"
import * as path from "path"

// Type definitions for node-notifier callback
type NotifierCallback = (err: Error | null, response: string, metadata?: any) => void

export interface DesktopNotificationOptions {
	title: string
	message: string
	icon?: string
	sound?: boolean
	wait?: boolean
	timeout?: number
	actions?: string[]
	closeLabel?: string
	dropdownLabel?: string
	reply?: boolean
}

export type NotificationType = "approval" | "completion" | "error" | "info"

let isDesktopNotificationsEnabled = false

export const setDesktopNotificationsEnabled = (enabled: boolean) => {
	isDesktopNotificationsEnabled = enabled
}

export const getDesktopNotificationsEnabled = (): boolean => {
	return isDesktopNotificationsEnabled
}

/**
 * Shows a desktop notification using the native OS notification system
 */
export const showDesktopNotification = async (
	type: NotificationType,
	options: DesktopNotificationOptions,
): Promise<void> => {
	if (!isDesktopNotificationsEnabled) {
		return
	}

	try {
		// Get the extension icon path
		const iconPath = getIconPath()

		const notificationOptions: notifier.Notification = {
			title: options.title,
			message: options.message,
			icon: options.icon || iconPath,
			wait: options.wait || false,
		}

		// Platform-specific customizations
		if (process.platform === "darwin") {
			// macOS specific options
			;(notificationOptions as any).subtitle = getSubtitleForType(type)
		} else if (process.platform === "win32") {
			// Windows specific options
			;(notificationOptions as any).appID = "RooCode"
		}

		await new Promise<void>((resolve, reject) => {
			notifier.notify(notificationOptions, (err: Error | null, response: string, metadata?: any) => {
				if (err) {
					reject(err)
				} else {
					resolve()
				}
			})
		})
	} catch (error) {
		// Silently fail - desktop notifications are not critical
		console.debug("Desktop notification failed:", error)
	}
}

/**
 * Shows a notification for approval requests
 */
export const showApprovalNotification = async (toolName: string, message?: string): Promise<void> => {
	await showDesktopNotification("approval", {
		title: "Roo Code - Approval Required",
		message: message || `AI agent needs approval to use ${toolName}`,
		sound: true,
		wait: false,
		timeout: 10, // Longer timeout for approval requests
	})
}

/**
 * Shows a notification for task completion
 */
export const showTaskCompletionNotification = async (success: boolean, taskSummary?: string): Promise<void> => {
	const title = success ? "Roo Code - Task Completed" : "Roo Code - Task Failed"
	const message = taskSummary || (success ? "AI agent has completed the task" : "AI agent encountered an error")

	await showDesktopNotification("completion", {
		title,
		message,
		sound: true,
		wait: false,
		timeout: 8,
	})
}

/**
 * Shows a notification for errors
 */
export const showErrorNotification = async (error: string): Promise<void> => {
	await showDesktopNotification("error", {
		title: "Roo Code - Error",
		message: error,
		sound: true,
		wait: false,
		timeout: 10,
	})
}

/**
 * Shows a notification for general information
 */
export const showInfoNotification = async (title: string, message: string): Promise<void> => {
	await showDesktopNotification("info", {
		title: `Roo Code - ${title}`,
		message,
		sound: false,
		wait: false,
		timeout: 5,
	})
}

/**
 * Gets the appropriate icon path for notifications
 */
function getIconPath(): string {
	try {
		// Try to use the extension icon
		return path.join(__dirname, "..", "..", "assets", "icons", "icon.png")
	} catch {
		// Fallback to no icon
		return ""
	}
}

/**
 * Gets subtitle for notification type (macOS only)
 */
function getSubtitleForType(type: NotificationType): string {
	switch (type) {
		case "approval":
			return "Action Required"
		case "completion":
			return "Task Update"
		case "error":
			return "Error Occurred"
		case "info":
			return "Information"
		default:
			return ""
	}
}
