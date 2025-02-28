// filepath: e:\Project\Roo-Code\src\api\providers\human-relay.ts
import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandlerOptions, ModelInfo } from "../../shared/api"
import { ApiHandler, SingleCompletionHandler } from "../index"
import { ApiStream } from "../transform/stream"
import * as vscode from "vscode"
import { ExtensionMessage } from "../../shared/ExtensionMessage"
import { getPanel } from "../../activate/registerCommands" // 导入 getPanel 函数

/**
 * Human Relay API processor
 * This processor does not directly call the API, but interacts with the model through human operations copy and paste.
 */
export class HumanRelayHandler implements ApiHandler, SingleCompletionHandler {
	private options: ApiHandlerOptions

	constructor(options: ApiHandlerOptions) {
		this.options = options
	}

	/**
	 * Create a message processing flow, display a dialog box to request human assistance
	 * @param systemPrompt System prompt words
	 * @param messages Message list
	 */
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// Get the most recent user message
		const latestMessage = messages[messages.length - 1]

		if (!latestMessage) {
			throw new Error("No message to relay")
		}

		// If it is the first message, splice the system prompt word with the user message
		let promptText = ""
		if (messages.length === 1) {
			promptText = `${systemPrompt}\n\n${getMessageContent(latestMessage)}`
		} else {
			promptText = getMessageContent(latestMessage)
		}

		// Copy to clipboard
		await vscode.env.clipboard.writeText(promptText)

		// A dialog box pops up to request user action
		const response = await showHumanRelayDialog(promptText)

		if (!response) {
			// The user canceled the operation
			throw new Error("Human relay operation cancelled")
		}

		// Return to the user input reply
		yield { type: "text", text: response }
	}

	/**
	 * Get model information
	 */
	getModel(): { id: string; info: ModelInfo } {
		// Human relay does not depend on a specific model, here is a default configuration
		return {
			id: "human-relay",
			info: {
				maxTokens: 16384,
				contextWindow: 100000,
				supportsImages: true,
				supportsPromptCache: false,
				supportsComputerUse: true,
				inputPrice: 0,
				outputPrice: 0,
				description: "Calling web-side AI model through human relay",
			},
		}
	}

	/**
	 * Implementation of a single prompt
	 * @param prompt Prompt content
	 */
	async completePrompt(prompt: string): Promise<string> {
		// Copy to clipboard
		await vscode.env.clipboard.writeText(prompt)

		// A dialog box pops up to request user action
		const response = await showHumanRelayDialog(prompt)

		if (!response) {
			throw new Error("Human relay operation cancelled")
		}

		return response
	}
}

/**
 * Extract text content from message object
 * @param message
 */
function getMessageContent(message: Anthropic.Messages.MessageParam): string {
	if (typeof message.content === "string") {
		return message.content
	} else if (Array.isArray(message.content)) {
		return message.content
			.filter((item) => item.type === "text")
			.map((item) => (item.type === "text" ? item.text : ""))
			.join("\n")
	}
	return ""
}
/**
 * Displays the human relay dialog and waits for user response.
 * @param promptText The prompt text that needs to be copied.
 * @returns The user's input response or undefined (if canceled).
 */
async function showHumanRelayDialog(promptText: string): Promise<string | undefined> {
	return new Promise<string | undefined>((resolve) => {
		// 创建一个唯一的请求 ID
		const requestId = Date.now().toString()

		// 注册全局回调函数
		vscode.commands.executeCommand(
			"roo-code.registerHumanRelayCallback",
			requestId,
			(response: string | undefined) => {
				resolve(response)
			},
		)

		// 检查 panel 是否已经初始化
		if (!getPanel()) {
			// 如果 panel 不存在，首先打开一个新面板
			vscode.commands.executeCommand("roo-cline.openInNewTab").then(() => {
				// 等待面板创建完成后再显示人工中继对话框
				setTimeout(() => {
					vscode.commands.executeCommand("roo-code.showHumanRelayDialog", {
						requestId,
						promptText,
					})
				}, 500) // 给面板创建留出一点时间
			})
		} else {
			// 如果 panel 已存在，直接显示对话框
			vscode.commands.executeCommand("roo-code.showHumanRelayDialog", {
				requestId,
				promptText,
			})
		}

		// 提供临时 UI，以防 WebView 加载失败
		vscode.window
			.showInformationMessage(
				"Please paste the copied message to the AI, then copy the response back into the dialog",
				{
					modal: true,
					detail: "The message has been copied to the clipboard. If the dialog does not open, please try using the input box.",
				},
				"Use Input Box",
			)
			.then((selection) => {
				if (selection === "Use Input Box") {
					// 注销回调
					vscode.commands.executeCommand("roo-code.unregisterHumanRelayCallback", requestId)

					vscode.window
						.showInputBox({
							prompt: "Please paste the AI's response here",
							placeHolder: "Paste the AI's response here...",
							ignoreFocusOut: true,
						})
						.then((input) => {
							resolve(input || undefined)
						})
				}
			})
	})
}
