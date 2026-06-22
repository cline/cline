import { AuthState, AuthStateChangedRequest } from "@shared/proto/cline/account"
import type { Controller } from "../index"

export async function authStateChanged(controller: Controller, _request: AuthStateChangedRequest): Promise<AuthState> {
	return controller.authService.getInfo()
}
