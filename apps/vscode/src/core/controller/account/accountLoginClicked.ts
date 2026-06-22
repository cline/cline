import { EmptyRequest, String } from "@shared/proto/cline/common"
import { Controller } from "../index"

/**
 * Starts Cline account sign-in. In e2e/local this performs a browserless mock token exchange; in
 * prod it runs the SDK OAuth flow. Returns a URL/status string for the webview.
 */
export async function accountLoginClicked(controller: Controller, _: EmptyRequest): Promise<String> {
	return controller.authService.createAuthRequest()
}
