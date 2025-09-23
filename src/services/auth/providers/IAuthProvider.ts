import { EnvironmentConfig } from "@/config"
import { Controller } from "@/core/controller"
import { ClineAuthInfo } from "../AuthService"

export interface IAuthProvider {
	readonly name: string
	config: EnvironmentConfig
	shouldRefreshIdToken(token: string, expiresAt?: number): Promise<boolean>
	retrieveClineAuthInfo(controller: Controller): Promise<ClineAuthInfo | null>
	refreshToken(refreshToken: string): Promise<Partial<ClineAuthInfo>>
	getAuthRequest(callbackUrl: string): Promise<string>
	signIn(controller: Controller, authorizationCode: string, provider: string): Promise<ClineAuthInfo | null>
}
