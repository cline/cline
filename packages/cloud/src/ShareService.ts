import * as vscode from "vscode"

import { shareResponseSchema } from "@roo-code/types"
import { getRooCodeApiUrl } from "./Config"
import type { AuthService } from "./AuthService"
import type { SettingsService } from "./SettingsService"
import { getUserAgent } from "./utils"

export type ShareVisibility = "organization" | "public"

export class TaskNotFoundError extends Error {
	constructor(taskId?: string) {
		super(taskId ? `Task '${taskId}' not found` : "Task not found")
		Object.setPrototypeOf(this, TaskNotFoundError.prototype)
	}
}

export class ShareService {
	private authService: AuthService
	private settingsService: SettingsService
	private log: (...args: unknown[]) => void

	constructor(authService: AuthService, settingsService: SettingsService, log?: (...args: unknown[]) => void) {
		this.authService = authService
		this.settingsService = settingsService
		this.log = log || console.log
	}

	/**
	 * Share a task with specified visibility
	 * Returns the share response data
	 */
	async shareTask(taskId: string, visibility: ShareVisibility = "organization") {
		try {
			const sessionToken = this.authService.getSessionToken()
			if (!sessionToken) {
				throw new Error("Authentication required")
			}

			const response = await fetch(`${getRooCodeApiUrl()}/api/extension/share`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
					"User-Agent": getUserAgent(),
				},
				body: JSON.stringify({ taskId, visibility }),
				signal: AbortSignal.timeout(10000),
			})

			if (!response.ok) {
				if (response.status === 404) {
					throw new TaskNotFoundError(taskId)
				}
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}

			const data = shareResponseSchema.parse(await response.json())
			this.log("[share] Share link created successfully:", data)

			if (data.success && data.shareUrl) {
				// Copy to clipboard
				await vscode.env.clipboard.writeText(data.shareUrl)
			}

			return data
		} catch (error) {
			this.log("[share] Error sharing task:", error)
			throw error
		}
	}

	/**
	 * Check if sharing is available
	 */
	async canShareTask(): Promise<boolean> {
		try {
			if (!this.authService.isAuthenticated()) {
				return false
			}

			return !!this.settingsService.getSettings()?.cloudSettings?.enableTaskSharing
		} catch (error) {
			this.log("[share] Error checking if task can be shared:", error)
			return false
		}
	}
}
