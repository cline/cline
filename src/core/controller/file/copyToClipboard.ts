import * as vscode from "vscode"
import { Controller } from ".."
import { Empty, StringRequest } from "../../../shared/proto/common"
import { writeTextToClipboard } from "@/utils/env"

/**
 * Copies text to the system clipboard
 * @param controller The controller instance
 * @param request The request containing the text to copy
 * @returns Empty response
 */
export async function copyToClipboard(controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		if (request.value) {
			await writeTextToClipboard(request.value)
		}
	} catch (error) {
		console.error("Error copying to clipboard:", error)
	}
	return Empty.create()
}
