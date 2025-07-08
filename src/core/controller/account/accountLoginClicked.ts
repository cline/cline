import { Controller } from "../index"
import { AuthService } from "@/services/auth/AuthService"
import { EmptyRequest, String } from "../../../shared/proto/common"
import { openExternal } from "@utils/env"

const authService = AuthService.getInstance()

/**
 * Handles the user clicking the login link in the UI.
 * Generates a secure nonce for state validation, stores it in secrets,
 * and opens the authentication URL in the external browser.
 *
 * @param controller The controller instance.
 * @returns The login URL as a string.
 */
export async function accountLoginClicked(controller: Controller, _: EmptyRequest): Promise<String> {
	return await authService.createAuthRequest()
}
