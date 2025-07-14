/**
 * Configuration interface for desktop notifications
 */
export interface NotificationConfig {
	/** Whether desktop notifications are enabled */
	enabled: boolean
	/** Whether to show notifications for approval requests */
	showApprovalRequests: boolean
	/** Whether to show notifications for errors */
	showErrors: boolean
	/** Whether to show notifications for task completion */
	showTaskCompletion: boolean
	/** Whether to show notifications when user input is required */
	showUserInputRequired: boolean
	/** Whether to show notifications for session timeouts */
	showSessionTimeouts: boolean
	/** Timeout in milliseconds for notifications (0 = no timeout) */
	timeout: number
	/** Whether to play sound with notifications */
	sound: boolean
}

/**
 * Default notification configuration
 */
export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
	enabled: true,
	showApprovalRequests: true,
	showErrors: true,
	showTaskCompletion: true,
	showUserInputRequired: true,
	showSessionTimeouts: true,
	timeout: 10000, // 10 seconds
	sound: true,
}

/**
 * Types of notifications that can be sent
 */
export enum NotificationType {
	APPROVAL_REQUEST = "approval_request",
	ERROR = "error",
	TASK_COMPLETION = "task_completion",
	USER_INPUT_REQUIRED = "user_input_required",
	SESSION_TIMEOUT = "session_timeout",
}

/**
 * Notification data structure
 */
export interface NotificationData {
	/** Type of notification */
	type: NotificationType
	/** Notification title */
	title: string
	/** Notification message */
	message: string
	/** Optional icon path */
	icon?: string
	/** Whether to play sound */
	sound?: boolean
	/** Timeout in milliseconds (0 = no timeout) */
	timeout?: number
	/** Optional actions for the notification */
	actions?: string[]
}

/**
 * Platform-specific notification options
 */
export interface PlatformNotificationOptions {
	/** Windows-specific options */
	windows?: {
		/** App ID for Windows notifications */
		appID?: string
		/** Whether to remove notification after timeout */
		remove?: boolean
	}
	/** macOS-specific options */
	macos?: {
		/** Bundle ID for macOS notifications */
		bundleId?: string
		/** Whether notification should be critical */
		critical?: boolean
	}
	/** Linux-specific options */
	linux?: {
		/** Desktop entry name */
		desktopEntry?: string
		/** Urgency level (low, normal, critical) */
		urgency?: "low" | "normal" | "critical"
	}
}
