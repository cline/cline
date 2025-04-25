import * as vscode from "vscode"
import crypto from "crypto"
import { Controller } from "../index"
import { storeSecret } from "../../storage/state"

/**
 * Returns the account login URL.
 * @param controller The controller instance.
 * @param request The empty request message.
 * @returns The login URL.
 */
export async function accountLoginClicked(controller: Controller): Promise<String> {
	// Generate nonce for state validation
	const nonce = crypto.randomBytes(32).toString("hex")
	await storeSecret(controller.context, "authNonce", nonce)

	// Open browser for authentication with state param
	console.log("Login button clicked in account page")
	console.log("Opening auth page with state param")

	const uriScheme = vscode.env.uriScheme

	const authUrl = vscode.Uri.parse(
		`https://app.cline.bot/auth?state=${encodeURIComponent(nonce)}&callback_url=${encodeURIComponent(`${uriScheme || "vscode"}://saoudrizwan.claude-dev/auth`)}`,
	)
	vscode.env.openExternal(authUrl)
	return authUrl.toString()
}
