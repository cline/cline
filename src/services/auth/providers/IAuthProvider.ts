import { EnvironmentConfig } from "@/config"
import { Controller } from "@/core/controller"
import { InternalAuthState } from "../AuthService"

export interface IAuthProvider {
	readonly name: string
	config: EnvironmentConfig
	retrieveClineAuthInfo(controller: Controller): Promise<InternalAuthState>
	shouldRefreshIdToken(token: string, expiresAt?: number): Promise<boolean>
	getAuthRequest(callbackUrl: string): Promise<string>
	signIn(controller: Controller, authorizationCode: string, provider: string): Promise<InternalAuthState>
}
