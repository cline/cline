import { Empty, StringRequest } from "@shared/proto/cline/common"
import * as vscode from "vscode"

const CLINE_OUTPUT_CHANNEL = vscode.window.createOutputChannel("Cline")

// Appends a log message to all Cline output channels.
export async function debugLog(request: StringRequest): Promise<Empty> {
	try {
		CLINE_OUTPUT_CHANNEL.appendLine(request.value)
	} catch (error) {
		// VS Code may dispose output channels before extension teardown finishes.
		if (!(error instanceof Error) || error.message !== "Channel has been closed") {
			throw error
		}
	}
	return Empty.create({})
}

// Register the Cline output channel within the VSCode extension context.
export function registerClineOutputChannel(context: vscode.ExtensionContext): vscode.OutputChannel {
	context.subscriptions.push(CLINE_OUTPUT_CHANNEL)
	return CLINE_OUTPUT_CHANNEL
}
