import { Empty, StringRequest } from "@shared/proto/beadsmith/common"
import * as vscode from "vscode"

const BEADSMITH_OUTPUT_CHANNEL = vscode.window.createOutputChannel("Beadsmith")

// Appends a log message to all Beadsmith output channels.
export async function debugLog(request: StringRequest): Promise<Empty> {
	BEADSMITH_OUTPUT_CHANNEL.appendLine(request.value)
	return Empty.create({})
}

// Register the Beadsmith output channel within the VSCode extension context.
export function registerBeadsmithOutputChannel(context: vscode.ExtensionContext): vscode.OutputChannel {
	context.subscriptions.push(BEADSMITH_OUTPUT_CHANNEL)
	return BEADSMITH_OUTPUT_CHANNEL
}
