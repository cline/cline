import type { SettingsService, ShareResponse, ShareVisibility } from "@roo-code/types"

import { importVscode } from "./importVscode.js"
import type { CloudAPI } from "./CloudAPI.js"

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
				const vscode = await importVscode()

				if (vscode?.env?.clipboard?.writeText) {
					try {
						await vscode.env.clipboard.writeText(response.shareUrl)
					} catch (copyErr) {
						this.log("[ShareService] Clipboard write failed (non-fatal):", copyErr)
					}
				} else {
					this.log("[ShareService] VS Code clipboard unavailable; running outside extension host.")
				}
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
