import * as vscode from "vscode"

import {
	ORGANIZATION_ALLOW_ALL,
	OrganizationAllowList,
	OrganizationSettings,
	organizationSettingsSchema,
} from "@roo-code/types"

import { getRooCodeApiUrl } from "./Config"
import { AuthService } from "./AuthService"
import { RefreshTimer } from "./RefreshTimer"

const ORGANIZATION_SETTINGS_CACHE_KEY = "organization-settings"

export class SettingsService {
	private context: vscode.ExtensionContext
	private authService: AuthService
	private settings: OrganizationSettings | undefined = undefined
	private timer: RefreshTimer
	private log: (...args: unknown[]) => void

	constructor(
		context: vscode.ExtensionContext,
		authService: AuthService,
		callback: () => void,
		log?: (...args: unknown[]) => void,
	) {
		this.context = context
		this.authService = authService
		this.log = log || console.log

		this.timer = new RefreshTimer({
			callback: async () => {
				return await this.fetchSettings(callback)
			},
			successInterval: 30000,
			initialBackoffMs: 1000,
			maxBackoffMs: 30000,
		})
	}

	public initialize(): void {
		this.loadCachedSettings()

		// Clear cached settings if we have missed a log out.
		if (this.authService.getState() == "logged-out" && this.settings) {
			this.removeSettings()
		}

		this.authService.on("active-session", () => {
			this.timer.start()
		})

		this.authService.on("logged-out", () => {
			this.timer.stop()
			this.removeSettings()
		})

		if (this.authService.hasActiveSession()) {
			this.timer.start()
		}
	}

	private async fetchSettings(callback: () => void): Promise<boolean> {
		const token = this.authService.getSessionToken()

		if (!token) {
			return false
		}

		try {
			const response = await fetch(`${getRooCodeApiUrl()}/api/organization-settings`, {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			})

			if (!response.ok) {
				this.log(
					"[cloud-settings] Failed to fetch organization settings:",
					response.status,
					response.statusText,
				)
				return false
			}

			const data = await response.json()
			const result = organizationSettingsSchema.safeParse(data)

			if (!result.success) {
				this.log("[cloud-settings] Invalid organization settings format:", result.error)
				return false
			}

			const newSettings = result.data

			if (!this.settings || this.settings.version !== newSettings.version) {
				this.settings = newSettings
				await this.cacheSettings()
				callback()
			}

			return true
		} catch (error) {
			this.log("[cloud-settings] Error fetching organization settings:", error)
			return false
		}
	}

	private async cacheSettings(): Promise<void> {
		await this.context.globalState.update(ORGANIZATION_SETTINGS_CACHE_KEY, this.settings)
	}

	private loadCachedSettings(): void {
		this.settings = this.context.globalState.get<OrganizationSettings>(ORGANIZATION_SETTINGS_CACHE_KEY)
	}

	public getAllowList(): OrganizationAllowList {
		return this.settings?.allowList || ORGANIZATION_ALLOW_ALL
	}

	public getSettings(): OrganizationSettings | undefined {
		return this.settings
	}

	public async removeSettings(): Promise<void> {
		this.settings = undefined
		await this.cacheSettings()
	}

	public dispose(): void {
		this.timer.stop()
	}
}
