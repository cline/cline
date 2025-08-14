import { AuthStateChangedRequest, AuthState } from "@shared/proto/cline/account"
import type { Controller } from "../index"

/**
 * Handles authentication state changes from the Firebase context.
 * Updates the user info in global state and returns the updated value.
 * @param controller The controller instance
 * @param request The auth state change request
 * @returns The updated user info
 */
export async function authStateChanged(controller: Controller, request: AuthStateChangedRequest): Promise<AuthState> {
	try {
		// Store the user info directly in global state
		controller.cacheService.setGlobalState("userInfo", request.user)

		// Return the same user info
		return AuthState.create({ user: request.user })
	} catch (error) {
		console.error(`Failed to update auth state: ${error}`)
		throw error
	}
}
