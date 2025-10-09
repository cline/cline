import type { Disposable, ExtensionContext } from "vscode"
import EventEmitter from "events"

import type {
	TelemetryEvent,
	ClineMessage,
	CloudServiceEvents,
	AuthService,
	SettingsService,
	CloudUserInfo,
	CloudOrganizationMembership,
	OrganizationAllowList,
	OrganizationSettings,
	ShareVisibility,
	UserSettingsConfig,
	UserSettingsData,
	UserFeatures,
} from "@roo-code/types"

import { TaskNotFoundError } from "./errors.js"
import { WebAuthService } from "./WebAuthService.js"
import { StaticTokenAuthService } from "./StaticTokenAuthService.js"
import { CloudSettingsService } from "./CloudSettingsService.js"
import { StaticSettingsService } from "./StaticSettingsService.js"
import { CloudTelemetryClient as TelemetryClient } from "./TelemetryClient.js"
import { CloudShareService } from "./CloudShareService.js"
import { CloudAPI } from "./CloudAPI.js"
import { RetryQueue } from "./retry-queue/index.js"

type AuthStateChangedPayload = CloudServiceEvents["auth-state-changed"][0]
type AuthUserInfoPayload = CloudServiceEvents["user-info"][0]
type SettingsPayload = CloudServiceEvents["settings-updated"][0]

export class CloudService extends EventEmitter<CloudServiceEvents> implements Disposable {
	private static _instance: CloudService | null = null

	private context: ExtensionContext

	private authStateListener: (data: AuthStateChangedPayload) => void
	private authUserInfoListener: (data: AuthUserInfoPayload) => void
	private settingsListener: (data: SettingsPayload) => void

	private isInitialized = false
	private log: (...args: unknown[]) => void

	/**
	 * Services
	 */

	private _authService: AuthService | null = null

	public get authService() {
		return this._authService
	}

	private _settingsService: SettingsService | null = null

	public get settingsService() {
		return this._settingsService
	}

	private _telemetryClient: TelemetryClient | null = null

	public get telemetryClient() {
		return this._telemetryClient
	}

	private _shareService: CloudShareService | null = null

	public get shareService() {
		return this._shareService
	}

	private _cloudAPI: CloudAPI | null = null

	public get cloudAPI() {
		return this._cloudAPI
	}

	private _retryQueue: RetryQueue | null = null

	public get retryQueue() {
		return this._retryQueue
	}

	private _isCloudAgent = false

	public get isCloudAgent() {
		return this._isCloudAgent
	}

	private constructor(context: ExtensionContext, log?: (...args: unknown[]) => void) {
		super()

		this.context = context
		this.log = log || console.log

		this.authStateListener = (data: AuthStateChangedPayload) => {
			// Handle retry queue based on auth state changes
			this.handleAuthStateChangeForRetryQueue(data)
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
			// For testing you can create a token with:
			// `pnpm --filter @roo-code-cloud/roomote-cli development auth job-token --job-id 1 --user-id user_2xmBhejNeDTwanM8CgIOnMgVxzC --org-id org_2wbhchVXZMQl8OS1yt0mrDazCpW`
			// The token will last for 1 hour.
			const cloudToken = process.env.ROO_CODE_CLOUD_TOKEN

			if (cloudToken && cloudToken.length > 0) {
				this._authService = new StaticTokenAuthService(this.context, cloudToken, this.log)
				this._isCloudAgent = true
			} else {
				this._authService = new WebAuthService(this.context, this.log)
			}

			this._authService.on("auth-state-changed", this.authStateListener)
			this._authService.on("user-info", this.authUserInfoListener)
			await this._authService.initialize()

			// Check for static settings environment variable.
			const staticOrgSettings = process.env.ROO_CODE_CLOUD_ORG_SETTINGS

			if (staticOrgSettings && staticOrgSettings.length > 0) {
				this._settingsService = new StaticSettingsService(staticOrgSettings, this.log)
			} else {
				const cloudSettingsService = new CloudSettingsService(this.context, this._authService, this.log)

				cloudSettingsService.on("settings-updated", this.settingsListener)
				await cloudSettingsService.initialize()

				this._settingsService = cloudSettingsService
			}

			this._cloudAPI = new CloudAPI(this._authService, this.log)

			// Initialize retry queue with auth header provider.
			this._retryQueue = new RetryQueue(
				this.context,
				undefined, // Use default config.
				this.log,
				() => {
					// Provide fresh auth headers for retries.
					const sessionToken = this._authService?.getSessionToken()

					if (sessionToken) {
						return { Authorization: `Bearer ${sessionToken}` }
					}

					return undefined
				},
			)

			this._telemetryClient = new TelemetryClient(this._authService, this._settingsService, this._retryQueue)

			this._shareService = new CloudShareService(this._cloudAPI, this._settingsService, this.log)

			this.isInitialized = true
		} catch (error) {
			this.log("[CloudService] Failed to initialize:", error)
			throw new Error(`Failed to initialize CloudService: ${error}`)
		}
	}

	// AuthService

	public async login(landingPageSlug?: string): Promise<void> {
		this.ensureInitialized()
		return this.authService!.login(landingPageSlug)
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

	public async switchOrganization(organizationId: string | null): Promise<void> {
		this.ensureInitialized()

		// Perform the organization switch
		// StaticTokenAuthService will throw an error if organization switching is not supported
		await this.authService!.switchOrganization(organizationId)
	}

	public async getOrganizationMemberships(): Promise<CloudOrganizationMembership[]> {
		this.ensureInitialized()

		// StaticTokenAuthService will throw an error if organization memberships are not supported
		return await this.authService!.getOrganizationMemberships()
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

	public getUserSettings(): UserSettingsData | undefined {
		this.ensureInitialized()
		return this.settingsService!.getUserSettings()
	}

	public getUserFeatures(): UserFeatures {
		this.ensureInitialized()
		return this.settingsService!.getUserFeatures()
	}

	public getUserSettingsConfig(): UserSettingsConfig {
		this.ensureInitialized()
		return this.settingsService!.getUserSettingsConfig()
	}

	public async updateUserSettings(settings: Partial<UserSettingsConfig>): Promise<boolean> {
		this.ensureInitialized()
		return this.settingsService!.updateUserSettings(settings)
	}

	public isTaskSyncEnabled(): boolean {
		this.ensureInitialized()
		return this.settingsService!.isTaskSyncEnabled()
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

		if (this._retryQueue) {
			this._retryQueue.dispose()
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
		context: ExtensionContext,
		log?: (...args: unknown[]) => void,
		eventHandlers?: Partial<{
			[K in keyof CloudServiceEvents]: (...args: CloudServiceEvents[K]) => void
		}>,
	): Promise<CloudService> {
		if (this._instance) {
			throw new Error("CloudService instance already created")
		}

		this._instance = new CloudService(context, log)

		await this._instance.initialize()

		if (eventHandlers) {
			for (const [event, handler] of Object.entries(eventHandlers)) {
				if (handler) {
					this._instance.on(
						event as keyof CloudServiceEvents,
						handler as (...args: CloudServiceEvents[keyof CloudServiceEvents]) => void,
					)
				}
			}
		}

		await this._instance.authService?.broadcast()

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

	/**
	 * Handle auth state changes for the retry queue
	 * - Pause queue when not in 'active-session' state
	 * - Clear queue when user logs out or logs in as different user
	 * - Resume queue when returning to active-session with same user
	 */
	private handleAuthStateChangeForRetryQueue(data: AuthStateChangedPayload): void {
		if (!this._retryQueue) {
			return
		}

		const newState = data.state
		const userInfo = this.getUserInfo()
		const newUserId = userInfo?.id

		this.log(`[CloudService] Auth state changed to: ${newState}, user: ${newUserId}`)

		// Handle different auth states
		switch (newState) {
			case "active-session": {
				// Check if user changed (different user logged in)
				const wasCleared = this._retryQueue.clearIfUserChanged(newUserId)

				if (!wasCleared) {
					// Same user or first login, resume the queue
					this._retryQueue.resume()
					this.log("[CloudService] Resuming retry queue for active session")
				} else {
					// Different user, queue was cleared, but we can resume processing
					this._retryQueue.resume()
					this.log("[CloudService] Retry queue cleared for new user, resuming processing")
				}
				break
			}

			case "logged-out":
				// User is logged out, clear the queue
				this._retryQueue.clearIfUserChanged(undefined)
				this._retryQueue.pause()
				this.log("[CloudService] Pausing and clearing retry queue for logged-out state")
				break

			case "initializing":
			case "attempting-session":
				// Transitional states, pause the queue but don't clear
				this._retryQueue.pause()
				this.log(`[CloudService] Pausing retry queue during ${newState}`)
				break

			case "inactive-session":
				// Session is inactive (possibly expired), pause but don't clear
				// The queue might resume if the session becomes active again
				this._retryQueue.pause()
				this.log("[CloudService] Pausing retry queue for inactive session")
				break

			default:
				// Unknown state, pause as a safety measure
				this._retryQueue.pause()
				this.log(`[CloudService] Pausing retry queue for unknown state: ${newState}`)
		}
	}
}
