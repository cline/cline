import * as vscode from "vscode"

import type { CloudUserInfo, TelemetryEvent, OrganizationAllowList } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { CloudServiceCallbacks } from "./types"
import { AuthService } from "./AuthService"
import { SettingsService } from "./SettingsService"
import { TelemetryClient } from "./TelemetryClient"

export class CloudService {
	private static _instance: CloudService | null = null

	private context: vscode.ExtensionContext
	private callbacks: CloudServiceCallbacks
	private authListener: () => void
	private authService: AuthService | null = null
	private settingsService: SettingsService | null = null
	private telemetryClient: TelemetryClient | null = null
	private isInitialized = false

	private constructor(context: vscode.ExtensionContext, callbacks: CloudServiceCallbacks) {
		this.context = context
		this.callbacks = callbacks
		this.authListener = () => {
			this.callbacks.stateChanged?.()
		}
	}

	public async initialize(): Promise<void> {
		if (this.isInitialized) {
			return
		}

		try {
			this.authService = await AuthService.createInstance(this.context)

			this.authService.on("active-session", this.authListener)
			this.authService.on("logged-out", this.authListener)
			this.authService.on("user-info", this.authListener)

			this.settingsService = await SettingsService.createInstance(this.context, () =>
				this.callbacks.stateChanged?.(),
			)

			this.telemetryClient = new TelemetryClient(this.authService, this.settingsService)

			try {
				TelemetryService.instance.register(this.telemetryClient)
			} catch (error) {
				console.warn("[CloudService] Failed to register TelemetryClient:", error)
			}

			this.isInitialized = true
		} catch (error) {
			console.error("[CloudService] Failed to initialize:", error)
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

	public getUserInfo(): CloudUserInfo | null {
		this.ensureInitialized()
		return this.authService!.getUserInfo()
	}

	public getAuthState(): string {
		this.ensureInitialized()
		return this.authService!.getState()
	}

	public async handleAuthCallback(code: string | null, state: string | null): Promise<void> {
		this.ensureInitialized()
		return this.authService!.handleCallback(code, state)
	}

	// SettingsService

	public getAllowList(): OrganizationAllowList {
		this.ensureInitialized()
		return this.settingsService!.getAllowList()
	}

	// TelemetryClient

	public captureEvent(event: TelemetryEvent): void {
		this.ensureInitialized()
		this.telemetryClient!.capture(event)
	}

	// Lifecycle

	public dispose(): void {
		if (this.authService) {
			this.authService.off("active-session", this.authListener)
			this.authService.off("logged-out", this.authListener)
			this.authService.off("user-info", this.authListener)
		}
		if (this.settingsService) {
			this.settingsService.dispose()
		}

		this.isInitialized = false
	}

	private ensureInitialized(): void {
		if (!this.isInitialized || !this.authService || !this.settingsService || !this.telemetryClient) {
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
		callbacks: CloudServiceCallbacks = {},
	): Promise<CloudService> {
		if (this._instance) {
			throw new Error("CloudService instance already created")
		}

		this._instance = new CloudService(context, callbacks)
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
