import axios from "axios"
import * as vscode from "vscode"

import { shareResponseSchema } from "@roo-code/types"
import { getRooCodeApiUrl } from "./Config"
import type { AuthService } from "./AuthService"
import type { SettingsService } from "./SettingsService"
import { getUserAgent } from "./utils"

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
	 * Share a task: Create link and copy to clipboard
	 * Returns true if successful, false if failed
	 */
	async shareTask(taskId: string): Promise<boolean> {
		try {
			const sessionToken = this.authService.getSessionToken()
			if (!sessionToken) {
				return false
			}

			const response = await axios.post(
				`${getRooCodeApiUrl()}/api/extension/share`,
				{ taskId },
				{
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
						"User-Agent": getUserAgent(),
					},
				},
			)

			const data = shareResponseSchema.parse(response.data)
			this.log("[share] Share link created successfully:", data)

			if (data.success && data.shareUrl) {
				// Copy to clipboard
				await vscode.env.clipboard.writeText(data.shareUrl)
				return true
			} else {
				this.log("[share] Share failed:", data.error)
				return false
			}
		} catch (error) {
			this.log("[share] Error sharing task:", error)
			return false
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
