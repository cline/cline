import { Empty, StringRequest } from "@shared/proto/bedrock_coder/common"
import * as vscode from "vscode"

const BEDROCK_CODER_OUTPUT_CHANNEL = vscode.window.createOutputChannel("Bedrock Coder")

// Appends a log message to all BedrockCoder output channels.
export async function debugLog(request: StringRequest): Promise<Empty> {
	BEDROCK_CODER_OUTPUT_CHANNEL.appendLine(request.value)
	return Empty.create({})
}

// Register the BedrockCoder output channel within the VSCode extension context.
export function registerBedrockCoderOutputChannel(context: vscode.ExtensionContext): vscode.OutputChannel {
	context.subscriptions.push(BEDROCK_CODER_OUTPUT_CHANNEL)
	return BEDROCK_CODER_OUTPUT_CHANNEL
}
