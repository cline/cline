import * as vscode from "vscode"
import { SetContextRequest, SetContextResponse } from "@/shared/proto/host/commands"

export async function setContext(request: SetContextRequest): Promise<SetContextResponse> {
	try {
		// Parse the value as JSON if possible, otherwise use as string
		let value: any = request.value
		try {
			value = JSON.parse(request.value)
		} catch {
			// Keep as string if JSON parsing fails
		}

		await vscode.commands.executeCommand("setContext", request.key, value)

		return SetContextResponse.create({
			success: true,
		})
	} catch (error) {
		console.error("Error setting context:", error)
		return SetContextResponse.create({
			success: false,
		})
	}
}
