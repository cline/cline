import EventEmitter from "events"

import { jwtDecode } from "jwt-decode"
import type { ExtensionContext } from "vscode"

import type { JWTPayload, CloudUserInfo, AuthService, AuthServiceEvents, AuthState } from "@roo-code/types"

export class StaticTokenAuthService extends EventEmitter<AuthServiceEvents> implements AuthService {
	private state: AuthState = "active-session"
	private token: string
	private log: (...args: unknown[]) => void
	private userInfo: CloudUserInfo

	constructor(context: ExtensionContext, token: string, log?: (...args: unknown[]) => void) {
		super()

		this.token = token
		this.log = log || console.log

		this.log("[auth] Using StaticTokenAuthService")

		let payload

		try {
			payload = jwtDecode<JWTPayload>(token)
		} catch (error) {
			this.log("[auth] Failed to parse JWT:", error)
		}

		this.userInfo = {
			id: payload?.r?.u || payload?.sub || undefined,
			organizationId: payload?.r?.o || undefined,
			extensionBridgeEnabled: true,
		}
	}

	public async initialize(): Promise<void> {
		this.state = "active-session"
	}

	public broadcast(): void {
		this.emit("auth-state-changed", {
			state: this.state,
			previousState: "initializing",
		})

		this.emit("user-info", { userInfo: this.userInfo })
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

	public async switchOrganization(_organizationId: string | null): Promise<void> {
		throw new Error("Authentication methods are disabled in StaticTokenAuthService")
	}

	public async getOrganizationMemberships(): Promise<import("@roo-code/types").CloudOrganizationMembership[]> {
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
		return this.userInfo
	}

	public getStoredOrganizationId(): string | null {
		return this.userInfo?.organizationId || null
	}
}
