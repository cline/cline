import * as vscode from "vscode"
import * as notifier from "node-notifier"
import * as path from "path"
import * as os from "os"
import {
	NotificationConfig,
	NotificationData,
	NotificationType,
	PlatformNotificationOptions,
	DEFAULT_NOTIFICATION_CONFIG,
} from "./types"

/**
 * Cross-platform desktop notification service for Roo Code
 * Provides OS-level notifications when the AI agent requires user interaction
 */
export class NotificationService {
	private config: NotificationConfig
	private readonly iconPath: string

	constructor(private readonly context: vscode.ExtensionContext) {
		this.config = this.loadConfig()
		this.iconPath = path.join(context.extensionPath, "assets", "icons", "icon.png")
	}

	/**
	 * Load notification configuration from VSCode settings
	 */
	private loadConfig(): NotificationConfig {
		const config = vscode.workspace.getConfiguration("roo-cline.notifications")
		return {
			enabled: config.get("enabled", DEFAULT_NOTIFICATION_CONFIG.enabled),
			showApprovalRequests: config.get("showApprovalRequests", DEFAULT_NOTIFICATION_CONFIG.showApprovalRequests),
			showErrors: config.get("showErrors", DEFAULT_NOTIFICATION_CONFIG.showErrors),
			showTaskCompletion: config.get("showTaskCompletion", DEFAULT_NOTIFICATION_CONFIG.showTaskCompletion),
			showUserInputRequired: config.get(
				"showUserInputRequired",
				DEFAULT_NOTIFICATION_CONFIG.showUserInputRequired,
			),
			showSessionTimeouts: config.get("showSessionTimeouts", DEFAULT_NOTIFICATION_CONFIG.showSessionTimeouts),
			timeout: config.get("timeout", DEFAULT_NOTIFICATION_CONFIG.timeout),
			sound: config.get("sound", DEFAULT_NOTIFICATION_CONFIG.sound),
		}
	}

	/**
	 * Update configuration when settings change
	 */
	public updateConfig(): void {
		this.config = this.loadConfig()
	}

	/**
	 * Check if notifications should be shown for a specific type
	 */
	private shouldShowNotification(type: NotificationType): boolean {
		if (!this.config.enabled) {
			return false
		}

		switch (type) {
			case NotificationType.APPROVAL_REQUEST:
				return this.config.showApprovalRequests
			case NotificationType.ERROR:
				return this.config.showErrors
			case NotificationType.TASK_COMPLETION:
				return this.config.showTaskCompletion
			case NotificationType.USER_INPUT_REQUIRED:
				return this.config.showUserInputRequired
			case NotificationType.SESSION_TIMEOUT:
				return this.config.showSessionTimeouts
			default:
				return false
		}
	}

	/**
	 * Get platform-specific notification options
	 */
	private getPlatformOptions(): PlatformNotificationOptions {
		const platform = os.platform()

		switch (platform) {
			case "win32":
				return {
					windows: {
						appID: "RooCode.VSCodeExtension",
						remove: this.config.timeout > 0,
					},
				}
			case "darwin":
				return {
					macos: {
						bundleId: "com.roocode.vscode-extension",
						critical: false,
					},
				}
			case "linux":
				return {
					linux: {
						desktopEntry: "roo-code",
						urgency: "normal",
					},
				}
			default:
				return {}
		}
	}

	/**
	 * Send a desktop notification
	 */
	public async sendNotification(data: NotificationData): Promise<void> {
		if (!this.shouldShowNotification(data.type)) {
			return
		}

		try {
			const platformOptions = this.getPlatformOptions()
			const timeout = data.timeout ?? this.config.timeout
			const sound = data.sound ?? this.config.sound

			// Prepare notification options based on platform
			const notificationOptions: any = {
				title: data.title,
				message: data.message,
				icon: data.icon || this.iconPath,
				sound: sound,
				wait: false, // Don't wait for user interaction
			}

			// Add timeout if specified
			if (timeout > 0) {
				notificationOptions.timeout = timeout / 1000 // node-notifier expects seconds
			}

			// Add platform-specific options
			const platform = os.platform()
			if (platform === "win32" && platformOptions.windows) {
				notificationOptions.appID = platformOptions.windows.appID
				notificationOptions.remove = platformOptions.windows.remove
			} else if (platform === "darwin" && platformOptions.macos) {
				notificationOptions.bundleId = platformOptions.macos.bundleId
				notificationOptions.critical = platformOptions.macos.critical
			} else if (platform === "linux" && platformOptions.linux) {
				notificationOptions.hint = `string:desktop-entry:${platformOptions.linux.desktopEntry}`
				notificationOptions.urgency = platformOptions.linux.urgency
			}

			// Send the notification
			await new Promise<void>((resolve, reject) => {
				notifier.notify(notificationOptions, (err: Error | null, response: any) => {
					if (err) {
						console.error("Failed to send notification:", err)
						reject(err)
					} else {
						resolve()
					}
				})
			})
		} catch (error) {
			console.error("Error sending desktop notification:", error)
			// Fallback to VSCode notification if desktop notification fails
			this.sendVSCodeFallbackNotification(data)
		}
	}

	/**
	 * Fallback to VSCode notification if desktop notification fails
	 */
	private sendVSCodeFallbackNotification(data: NotificationData): void {
		const message = `${data.title}: ${data.message}`

		switch (data.type) {
			case NotificationType.ERROR:
				vscode.window.showErrorMessage(message)
				break
			case NotificationType.APPROVAL_REQUEST:
			case NotificationType.USER_INPUT_REQUIRED:
				vscode.window.showWarningMessage(message)
				break
			default:
				vscode.window.showInformationMessage(message)
				break
		}
	}

	/**
	 * Send an approval request notification
	 */
	public async sendApprovalRequest(message: string, toolName?: string): Promise<void> {
		const title = toolName ? `${toolName} - Approval Required` : "Approval Required"
		await this.sendNotification({
			type: NotificationType.APPROVAL_REQUEST,
			title,
			message,
		})
	}

	/**
	 * Send an error notification
	 */
	public async sendError(message: string, error?: Error): Promise<void> {
		const errorMessage = error ? `${message}: ${error.message}` : message
		await this.sendNotification({
			type: NotificationType.ERROR,
			title: "Roo Code Error",
			message: errorMessage,
		})
	}

	/**
	 * Send a task completion notification
	 */
	public async sendTaskCompletion(message: string): Promise<void> {
		await this.sendNotification({
			type: NotificationType.TASK_COMPLETION,
			title: "Task Completed",
			message,
		})
	}

	/**
	 * Send a user input required notification
	 */
	public async sendUserInputRequired(message: string): Promise<void> {
		await this.sendNotification({
			type: NotificationType.USER_INPUT_REQUIRED,
			title: "Input Required",
			message,
		})
	}

	/**
	 * Send a session timeout notification
	 */
	public async sendSessionTimeout(message: string): Promise<void> {
		await this.sendNotification({
			type: NotificationType.SESSION_TIMEOUT,
			title: "Session Timeout",
			message,
		})
	}

	/**
	 * Test notification functionality
	 */
	public async testNotification(): Promise<void> {
		await this.sendNotification({
			type: NotificationType.APPROVAL_REQUEST,
			title: "Roo Code Notification Test",
			message: "Desktop notifications are working correctly!",
		})
	}

	/**
	 * Dispose of the service
	 */
	public dispose(): void {
		// Clean up any resources if needed
	}
}
