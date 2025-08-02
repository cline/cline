import * as vscode from "vscode"

import type { ShareResponse, ShareVisibility } from "@roo-code/types"

import type { CloudAPI } from "./CloudAPI"
import type { SettingsService } from "./SettingsService"

export class CloudShareService {
	private cloudAPI: CloudAPI
	private settingsService: SettingsService
	private log: (...args: unknown[]) => void

	constructor(cloudAPI: CloudAPI, settingsService: SettingsService, log?: (...args: unknown[]) => void) {
		this.cloudAPI = cloudAPI
		this.settingsService = settingsService
		this.log = log || console.log
	}

	async shareTask(taskId: string, visibility: ShareVisibility = "organization"): Promise<ShareResponse> {
		try {
			const response = await this.cloudAPI.shareTask(taskId, visibility)

			if (response.success && response.shareUrl) {
				// Copy to clipboard.
				await vscode.env.clipboard.writeText(response.shareUrl)
			}

			return response
		} catch (error) {
			this.log("[ShareService] Error sharing task:", error)
			throw error
		}
	}

	async canShareTask(): Promise<boolean> {
		try {
			return !!this.settingsService.getSettings()?.cloudSettings?.enableTaskSharing
		} catch (error) {
			this.log("[ShareService] Error checking if task can be shared:", error)
			return false
		}
	}
}
