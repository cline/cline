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
	private static _instance: SettingsService | null = null

	private context: vscode.ExtensionContext
	private authService: AuthService
	private settings: OrganizationSettings | undefined = undefined
	private timer: RefreshTimer

	private constructor(context: vscode.ExtensionContext, authService: AuthService, callback: () => void) {
		this.context = context
		this.authService = authService

		this.timer = new RefreshTimer({
			callback: async () => {
				await this.fetchSettings(callback)
				return true
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

	private async fetchSettings(callback: () => void): Promise<void> {
		const token = this.authService.getSessionToken()

		if (!token) {
			return
		}

		try {
			const response = await fetch(`${getRooCodeApiUrl()}/api/organization-settings`, {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			})

			if (!response.ok) {
				console.error(`Failed to fetch organization settings: ${response.status} ${response.statusText}`)
				return
			}

			const data = await response.json()
			const result = organizationSettingsSchema.safeParse(data)

			if (!result.success) {
				console.error("Invalid organization settings format:", result.error)
				return
			}

			const newSettings = result.data

			if (!this.settings || this.settings.version !== newSettings.version) {
				this.settings = newSettings
				await this.cacheSettings()
				callback()
			}
		} catch (error) {
			console.error("Error fetching organization settings:", error)
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

	static get instance() {
		if (!this._instance) {
			throw new Error("SettingsService not initialized")
		}

		return this._instance
	}

	static async createInstance(context: vscode.ExtensionContext, callback: () => void) {
		if (this._instance) {
			throw new Error("SettingsService instance already created")
		}

		this._instance = new SettingsService(context, AuthService.instance, callback)
		this._instance.initialize()
		return this._instance
	}
}
