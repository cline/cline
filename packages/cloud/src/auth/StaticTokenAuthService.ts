import EventEmitter from "events"
import * as vscode from "vscode"
import type { CloudUserInfo } from "@roo-code/types"
import type { AuthService, AuthServiceEvents, AuthState } from "./AuthService"

export class StaticTokenAuthService extends EventEmitter<AuthServiceEvents> implements AuthService {
	private state: AuthState = "active-session"
	private token: string
	private log: (...args: unknown[]) => void

	constructor(context: vscode.ExtensionContext, token: string, log?: (...args: unknown[]) => void) {
		super()
		this.token = token
		this.log = log || console.log
		this.log("[auth] Using static token authentication mode")
	}

	public async initialize(): Promise<void> {
		const previousState: AuthState = "initializing"
		this.state = "active-session"
		this.emit("active-session", { previousState })
		this.log("[auth] Static token auth service initialized in active-session state")
	}

	public async login(): Promise<void> {
		throw new Error("Authentication methods are disabled in StaticTokenAuthService")
	}

	public async logout(): Promise<void> {
		throw new Error("Authentication methods are disabled in StaticTokenAuthService")
	}

	public async handleCallback(
		_code: string | null,
		_state: string | null,
		_organizationId?: string | null,
	): Promise<void> {
		throw new Error("Authentication methods are disabled in StaticTokenAuthService")
	}

	public getState(): AuthState {
		return this.state
	}

	public getSessionToken(): string | undefined {
		return this.token
	}

	public isAuthenticated(): boolean {
		return true
	}

	public hasActiveSession(): boolean {
		return true
	}

	public hasOrIsAcquiringActiveSession(): boolean {
		return true
	}

	public getUserInfo(): CloudUserInfo | null {
		return {}
	}

	public getStoredOrganizationId(): string | null {
		return null
	}
}
