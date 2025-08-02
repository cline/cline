import * as vscode from "vscode"
import EventEmitter from "events"

import type {
	CloudUserInfo,
	TelemetryEvent,
	OrganizationAllowList,
	OrganizationSettings,
	ClineMessage,
	ShareVisibility,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { CloudServiceEvents } from "./types"
import { TaskNotFoundError } from "./errors"
import type { AuthService } from "./auth"
import { WebAuthService, StaticTokenAuthService } from "./auth"
import type { SettingsService } from "./SettingsService"
import { CloudSettingsService } from "./CloudSettingsService"
import { StaticSettingsService } from "./StaticSettingsService"
import { TelemetryClient } from "./TelemetryClient"
import { CloudShareService } from "./CloudShareService"
import { CloudAPI } from "./CloudAPI"

type AuthStateChangedPayload = CloudServiceEvents["auth-state-changed"][0]
type AuthUserInfoPayload = CloudServiceEvents["user-info"][0]
type SettingsPayload = CloudServiceEvents["settings-updated"][0]

export class CloudService extends EventEmitter<CloudServiceEvents> implements vscode.Disposable {
	private static _instance: CloudService | null = null

	private context: vscode.ExtensionContext
	private authStateListener: (data: AuthStateChangedPayload) => void
	private authUserInfoListener: (data: AuthUserInfoPayload) => void
	private authService: AuthService | null = null
	private settingsListener: (data: SettingsPayload) => void
	private settingsService: SettingsService | null = null
	private telemetryClient: TelemetryClient | null = null
	private shareService: CloudShareService | null = null
	private cloudAPI: CloudAPI | null = null
	private isInitialized = false
	private log: (...args: unknown[]) => void

	private constructor(context: vscode.ExtensionContext, log?: (...args: unknown[]) => void) {
		super()

		this.context = context
		this.log = log || console.log
		this.authStateListener = (data: AuthStateChangedPayload) => {
			this.emit("auth-state-changed", data)
		}
		this.authUserInfoListener = (data: AuthUserInfoPayload) => {
			this.emit("user-info", data)
		}
		this.settingsListener = (data: SettingsPayload) => {
			this.emit("settings-updated", data)
		}
	}

	public async initialize(): Promise<void> {
		if (this.isInitialized) {
			return
		}

		try {
			const cloudToken = process.env.ROO_CODE_CLOUD_TOKEN

			if (cloudToken && cloudToken.length > 0) {
				this.authService = new StaticTokenAuthService(this.context, cloudToken, this.log)
			} else {
				this.authService = new WebAuthService(this.context, this.log)
			}

			await this.authService.initialize()

			this.authService.on("auth-state-changed", this.authStateListener)
			this.authService.on("user-info", this.authUserInfoListener)

			// Check for static settings environment variable.
			const staticOrgSettings = process.env.ROO_CODE_CLOUD_ORG_SETTINGS

			if (staticOrgSettings && staticOrgSettings.length > 0) {
				this.settingsService = new StaticSettingsService(staticOrgSettings, this.log)
			} else {
				const cloudSettingsService = new CloudSettingsService(this.context, this.authService, this.log)
				cloudSettingsService.initialize()

				cloudSettingsService.on("settings-updated", this.settingsListener)

				this.settingsService = cloudSettingsService
			}

			this.cloudAPI = new CloudAPI(this.authService, this.log)
			this.telemetryClient = new TelemetryClient(this.authService, this.settingsService)
			this.shareService = new CloudShareService(this.cloudAPI, this.settingsService, this.log)

			try {
				TelemetryService.instance.register(this.telemetryClient)
			} catch (error) {
				this.log("[CloudService] Failed to register TelemetryClient:", error)
			}

			this.isInitialized = true
		} catch (error) {
			this.log("[CloudService] Failed to initialize:", error)
			throw new Error(`Failed to initialize CloudService: ${error}`)
		}
	}

	// AuthService

	public async login(): Promise<void> {
		this.ensureInitialized()
		return this.authService!.login()
	}

	public async logout(): Promise<void> {
		this.ensureInitialized()
		return this.authService!.logout()
	}

	public isAuthenticated(): boolean {
		this.ensureInitialized()
		return this.authService!.isAuthenticated()
	}

	public hasActiveSession(): boolean {
		this.ensureInitialized()
		return this.authService!.hasActiveSession()
	}

	public hasOrIsAcquiringActiveSession(): boolean {
		this.ensureInitialized()
		return this.authService!.hasOrIsAcquiringActiveSession()
	}

	public getUserInfo(): CloudUserInfo | null {
		this.ensureInitialized()
		return this.authService!.getUserInfo()
	}

	public getOrganizationId(): string | null {
		this.ensureInitialized()
		const userInfo = this.authService!.getUserInfo()
		return userInfo?.organizationId || null
	}

	public getOrganizationName(): string | null {
		this.ensureInitialized()
		const userInfo = this.authService!.getUserInfo()
		return userInfo?.organizationName || null
	}

	public getOrganizationRole(): string | null {
		this.ensureInitialized()
		const userInfo = this.authService!.getUserInfo()
		return userInfo?.organizationRole || null
	}

	public hasStoredOrganizationId(): boolean {
		this.ensureInitialized()
		return this.authService!.getStoredOrganizationId() !== null
	}

	public getStoredOrganizationId(): string | null {
		this.ensureInitialized()
		return this.authService!.getStoredOrganizationId()
	}

	public getAuthState(): string {
		this.ensureInitialized()
		return this.authService!.getState()
	}

	public async handleAuthCallback(
		code: string | null,
		state: string | null,
		organizationId?: string | null,
	): Promise<void> {
		this.ensureInitialized()
		return this.authService!.handleCallback(code, state, organizationId)
	}

	// SettingsService

	public getAllowList(): OrganizationAllowList {
		this.ensureInitialized()
		return this.settingsService!.getAllowList()
	}

	public getOrganizationSettings(): OrganizationSettings | undefined {
		this.ensureInitialized()
		return this.settingsService!.getSettings()
	}

	// TelemetryClient

	public captureEvent(event: TelemetryEvent): void {
		this.ensureInitialized()
		this.telemetryClient!.capture(event)
	}

	// ShareService

	public async shareTask(
		taskId: string,
		visibility: ShareVisibility = "organization",
		clineMessages?: ClineMessage[],
	) {
		this.ensureInitialized()

		try {
			return await this.shareService!.shareTask(taskId, visibility)
		} catch (error) {
			if (error instanceof TaskNotFoundError && clineMessages) {
				// Backfill messages and retry.
				await this.telemetryClient!.backfillMessages(clineMessages, taskId)
				return await this.shareService!.shareTask(taskId, visibility)
			}
			throw error
		}
	}

	public async canShareTask(): Promise<boolean> {
		this.ensureInitialized()
		return this.shareService!.canShareTask()
	}

	// Lifecycle

	public dispose(): void {
		if (this.authService) {
			this.authService.off("auth-state-changed", this.authStateListener)
			this.authService.off("user-info", this.authUserInfoListener)
		}

		if (this.settingsService) {
			if (this.settingsService instanceof CloudSettingsService) {
				this.settingsService.off("settings-updated", this.settingsListener)
			}
			this.settingsService.dispose()
		}

		this.isInitialized = false
	}

	private ensureInitialized(): void {
		if (!this.isInitialized) {
			throw new Error("CloudService not initialized.")
		}
	}

	static get instance(): CloudService {
		if (!this._instance) {
			throw new Error("CloudService not initialized")
		}

		return this._instance
	}

	static async createInstance(
		context: vscode.ExtensionContext,
		log?: (...args: unknown[]) => void,
	): Promise<CloudService> {
		if (this._instance) {
			throw new Error("CloudService instance already created")
		}

		this._instance = new CloudService(context, log)
		await this._instance.initialize()
		return this._instance
	}

	static hasInstance(): boolean {
		return this._instance !== null && this._instance.isInitialized
	}

	static resetInstance(): void {
		if (this._instance) {
			this._instance.dispose()
			this._instance = null
		}
	}

	static isEnabled(): boolean {
		return !!this._instance?.isAuthenticated()
	}
}
