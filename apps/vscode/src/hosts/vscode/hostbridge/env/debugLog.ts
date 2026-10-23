import { Empty, StringRequest } from "@shared/proto/cline/common"
import * as vscode from "vscode"

const CLINE_OUTPUT_CHANNEL = vscode.window.createOutputChannel("Cline")

// Appends a log message to all Cline output channels with log level severity routing.
export async function debugLog(request: StringRequest): Promise<Empty> {
	const text = request.value
	const logChannel = CLINE_OUTPUT_CHANNEL as vscode.LogOutputChannel
	if (typeof logChannel.info === "function") {
		if (text.startsWith("[ERROR]")) {
			logChannel.error(text.slice(7).trimStart())
		} else if (text.startsWith("[WARN]")) {
			logChannel.warn(text.slice(6).trimStart())
		} else if (text.startsWith("[INFO]")) {
			logChannel.info(text.slice(6).trimStart())
		} else if (text.startsWith("[DEBUG]")) {
			logChannel.debug(text.slice(7).trimStart())
		} else {
			logChannel.info(text)
		}
	} else {
		CLINE_OUTPUT_CHANNEL.appendLine(text)
	}
	return Empty.create({})
}

// Register the Cline output channel within the VSCode extension context.
export function registerClineOutputChannel(context: vscode.ExtensionContext): vscode.OutputChannel {
	context.subscriptions.push(CLINE_OUTPUT_CHANNEL)
	return CLINE_OUTPUT_CHANNEL
}
