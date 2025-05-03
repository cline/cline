import { Controller } from ".."
import * as vscode from "vscode"
import { OpenUrlRequest } from "@shared/proto/system"
import { Empty } from "@shared/proto/common"

/**
 * Open the provided URL using the OS
 * @param controller The controller instance
 * @param request The request message containing the URL
 * @returns Nothing, regardless of result
 */
export async function openUrl(controller: Controller, request: OpenUrlRequest): Promise<Empty> {
	if (request.url) {
		console.log(`Opening URL: ${request.url}`) // TODO: Remove console log after testing
		try {
			await vscode.env.openExternal(vscode.Uri.parse(request.url))
		} catch (error) {
			console.error(`Failed to open URL ${request.url}:`, error)
		}
	}
	return Empty.create()
}
