import * as vscode from "vscode"
import { Controller } from ".."
import { Empty, StringRequest } from "../../../shared/proto/common"

/**
 * Opens a URL in the user's default browser
 * @param controller The controller instance
 * @param request The URL to open
 * @returns Empty response since the client doesn't need a return value
 */
export async function openInBrowser(controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		if (request.value) {
			await vscode.env.openExternal(vscode.Uri.parse(request.value))
		}
		return Empty.create()
	} catch (error) {
		console.error("Error opening URL in browser:", error)
		return Empty.create()
	}
}
