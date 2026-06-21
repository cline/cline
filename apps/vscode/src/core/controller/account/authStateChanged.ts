import { AuthState, AuthStateChangedRequest } from "@shared/proto/cline/account"
import type { Controller } from "../index"

export async function authStateChanged(_controller: Controller, _request: AuthStateChangedRequest): Promise<AuthState> {
	return AuthState.create({})
}
