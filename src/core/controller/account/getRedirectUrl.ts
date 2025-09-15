import { EmptyRequest, String } from "@shared/proto/cline/common"
import * as vscode from "vscode"
import { Controller } from "../index"

/**
 * Handles the user clicking the login link in the UI.
 * Generates a secure nonce for state validation, stores it in secrets,
 * and opens the authentication URL in the external browser.
 *
 * @param controller The controller instance.
 * @returns The login URL as a string.
 */
export async function getRedirectUrl(_controller: Controller, _: EmptyRequest): Promise<String> {
	const uriScheme = vscode.env.uriScheme
	const callbackUrl = `${uriScheme || "vscode"}://saoudrizwan.claude-dev`
	return { value: callbackUrl }
}
