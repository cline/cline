import { Empty, StringRequest } from "@shared/proto/cline/common"
import * as vscode from "vscode"

const CLINE_OUTPUT_CHANNEL_MAP = new Map<string, vscode.OutputChannel>()

// Appends a log message to all Cline output channels.
export async function appendOutputLog(request: StringRequest): Promise<Empty> {
	CLINE_OUTPUT_CHANNEL_MAP.forEach((channel) => channel.appendLine(request.value))
	return Empty.create({})
}

// Creates a VSCode output channel for Cline logs.
// If an output channel with the same name already exists, an error is thrown.
export function createVSCodeOutputChannel(context: vscode.ExtensionContext, channelName = "Cline"): vscode.OutputChannel {
	if (CLINE_OUTPUT_CHANNEL_MAP.has(channelName)) {
		throw new Error("Output channel already initialized")
	}
	const outputChannel = vscode.window.createOutputChannel(channelName)
	CLINE_OUTPUT_CHANNEL_MAP.set(channelName, outputChannel)
	context.subscriptions.push(outputChannel)
	return outputChannel
}
