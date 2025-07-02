import EventEmitter from "events"
import type { CloudUserInfo } from "@roo-code/types"

export interface AuthServiceEvents {
	"attempting-session": [data: { previousState: AuthState }]
	"inactive-session": [data: { previousState: AuthState }]
	"active-session": [data: { previousState: AuthState }]
	"logged-out": [data: { previousState: AuthState }]
	"user-info": [data: { userInfo: CloudUserInfo }]
}

export type AuthState = "initializing" | "logged-out" | "active-session" | "attempting-session" | "inactive-session"

export interface AuthService extends EventEmitter<AuthServiceEvents> {
	// Lifecycle
	initialize(): Promise<void>

	// Authentication methods
	login(): Promise<void>
	logout(): Promise<void>
	handleCallback(code: string | null, state: string | null, organizationId?: string | null): Promise<void>

	// State methods
	getState(): AuthState
	isAuthenticated(): boolean
	hasActiveSession(): boolean
	hasOrIsAcquiringActiveSession(): boolean

	// Token and user info
	getSessionToken(): string | undefined
	getUserInfo(): CloudUserInfo | null
	getStoredOrganizationId(): string | null
}
