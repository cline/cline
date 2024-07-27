import { Uri, Webview } from "vscode"
import * as vscode from "vscode"
import { ClaudeMessage, ExtensionMessage, Task as ExtensionTask } from "../shared/ExtensionMessage"
import { TaskHistoryManager, Message, Task } from "../TaskHistoryManager"
import { WebviewMessage } from "../shared/WebviewMessage"
import { ClaudeDev } from "../ClaudeDev"

type ExtensionSecretKey = "apiKey"
type ExtensionGlobalStateKey = "didOpenOnce" | "maxRequestsPerTask"
type ExtensionWorkspaceStateKey = "claudeMessages"

export class SidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "claude-dev.SidebarProvider"

	private view?: vscode.WebviewView
	private claudeDev?: ClaudeDev
	private taskHistoryManager: TaskHistoryManager
	private currentTask?: string

	constructor(public readonly context: vscode.ExtensionContext) {
		this.taskHistoryManager = new TaskHistoryManager(context)
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext<unknown>,
		token: vscode.CancellationToken
	): void | Thenable<void> {
		this.view = webviewView

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.context.extensionUri],
		}
		webviewView.webview.html = this.getHtmlContent(webviewView.webview)

		this.setWebviewMessageListener(webviewView.webview)

		webviewView.onDidChangeVisibility((e: any) => {
			if (e.visible) {
				this.postMessageToWebview({ type: "action", action: "didBecomeVisible" })
			}
		})

		this.clearTask()
	}

	// Initializing new instance of ClaudeDev will make sure that any agentically running promises in old instance don't affect our new task. this essentially creates a fresh slate for the new task
	async tryToInitClaudeDevWithTask(task: string) {
		const [apiKey, maxRequestsPerTask] = await Promise.all([
			this.getSecret("apiKey") as Promise<string | undefined>,
			this.getGlobalState("maxRequestsPerTask") as Promise<number | undefined>,
		])
		if (this.view && apiKey) {
			this.claudeDev = new ClaudeDev(this, task, apiKey, maxRequestsPerTask)
			this.currentTask = task
		}
	}

	async postMessageToWebview(message: ExtensionMessage) {
		console.log("Posting message to webview:", JSON.stringify(message, null, 2))
		await this.view?.webview.postMessage(message)
	}

	private getHtmlContent(webview: vscode.Webview): string {
		const stylesUri = getUri(webview, this.context.extensionUri, [
			"webview-ui",
			"build",
			"static",
			"css",
			"main.css",
		])
		const scriptUri = getUri(webview, this.context.extensionUri, ["webview-ui", "build", "static", "js", "main.js"])
		const codiconsUri = getUri(webview, this.context.extensionUri, [
			"node_modules",
			"@vscode",
			"codicons",
			"dist",
			"codicon.css",
		])

		const nonce = getNonce()

		return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
            <meta name="theme-color" content="#000000">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
            <link rel="stylesheet" type="text/css" href="${stylesUri}">
			<link href="${codiconsUri}" rel="stylesheet" />
            <title>Claude Dev</title>
          </head>
          <body>
            <noscript>You need to enable JavaScript to run this app.</noscript>
            <div id="root"></div>
            <script nonce="${nonce}" src="${scriptUri}"></script>
          </body>
        </html>
      `
	}

	private setWebviewMessageListener(webview: vscode.Webview) {
		webview.onDidReceiveMessage(async (message: WebviewMessage) => {
			console.log("Received message from webview:", JSON.stringify(message, null, 2))
			switch (message.type) {
				case "webviewDidLaunch":
					await this.updateGlobalState("didOpenOnce", true)
					await this.postStateToWebview()
					await this.postTaskHistoryToWebview()
					break
				case "newTask":
					await this.tryToInitClaudeDevWithTask(message.text!)
					this.taskHistoryManager.addTask(message.text!, [])
					await this.postTaskHistoryToWebview()
					break
				case "loadTask":
					if ("taskId" in message && message.taskId) {
						await this.loadTaskFromHistory(message.taskId)
					}
					break
				case "apiKey":
					await this.storeSecret("apiKey", message.text!)
					this.claudeDev?.updateApiKey(message.text!)
					await this.postStateToWebview()
					break
				case "maxRequestsPerTask":
					let result: number | undefined = undefined
					if (message.text && message.text.trim()) {
						const num = Number(message.text)
						if (!isNaN(num)) {
							result = num
						}
					}
					await this.updateGlobalState("maxRequestsPerTask", result)
					this.claudeDev?.updateMaxRequestsPerTask(result)
					await this.postStateToWebview()
					break
				case "askResponse":
					this.claudeDev?.handleWebviewAskResponse(message.askResponse!, message.text)
					break
				case "clearTask":
					await this.clearTask()
					await this.postStateToWebview()
					break
			}
		})
	}

	async postStateToWebview() {
		const [didOpenOnce, apiKey, maxRequestsPerTask, claudeMessages] = await Promise.all([
			this.getGlobalState("didOpenOnce") as Promise<boolean | undefined>,
			this.getSecret("apiKey") as Promise<string | undefined>,
			this.getGlobalState("maxRequestsPerTask") as Promise<number | undefined>,
			this.getClaudeMessages(),
		])
		this.postMessageToWebview({
			type: "state",
			state: { didOpenOnce: !!didOpenOnce, apiKey, maxRequestsPerTask, claudeMessages },
		})
	}

	async postTaskHistoryToWebview() {
		const tasks = this.taskHistoryManager.getTasks()
		console.log("Posting task history to webview:", JSON.stringify(tasks, null, 2))
		this.postMessageToWebview({
			type: "taskHistory",
			taskHistory: tasks.map((task) => ({
				id: task.id,
				description: task.description,
				timestamp: task.timestamp,
				messages: task.messages,
			})),
		})
	}

	async clearTask() {
		if (this.claudeDev) {
			this.claudeDev.abort = true // Will stop any agentically running promises
			this.claudeDev = undefined // Removes reference to it, so once promises end it will be garbage collected
		}
		this.currentTask = undefined
		await this.setClaudeMessages([])
	}

	async loadTaskFromHistory(taskId: string) {
		console.log("Loading task from history. TaskId:", taskId)
		const task = this.taskHistoryManager.getTaskById(taskId)
		console.log("Task found:", JSON.stringify(task, null, 2))
		if (task) {
			await this.clearTask()
			this.currentTask = task.description
			console.log("Loading messages from history:", JSON.stringify(task.messages, null, 2))
			await this.setClaudeMessages(task.messages)
			await this.postStateToWebview()
			// Send a separate message to the webview to ensure it updates the UI
			this.postMessageToWebview({
				type: "loadedTaskHistory",
				messages: task.messages,
			})
		} else {
			console.error("Task not found for id:", taskId)
		}
	}

	async getClaudeMessages(): Promise<ClaudeMessage[]> {
		const messages = (await this.getWorkspaceState("claudeMessages")) as ClaudeMessage[]
		console.log("Getting Claude messages:", JSON.stringify(messages, null, 2))
		return messages || []
	}

	async setClaudeMessages(messages: ClaudeMessage[] | undefined) {
		console.log("Setting Claude messages:", JSON.stringify(messages, null, 2))
		await this.updateWorkspaceState("claudeMessages", messages)
		if (this.currentTask) {
			const currentTask = this.taskHistoryManager.getTasks().find((task) => task.description === this.currentTask)
			if (currentTask) {
				this.taskHistoryManager.updateTaskMessages(currentTask.id, messages || [])
			}
		}
		await this.postTaskHistoryToWebview()
	}

	async addClaudeMessage(message: ClaudeMessage): Promise<ClaudeMessage[]> {
		const messages = await this.getClaudeMessages()
		messages.push(message)
		await this.setClaudeMessages(messages)
		return messages
	}

	private async updateGlobalState(key: ExtensionGlobalStateKey, value: any) {
		await this.context.globalState.update(key, value)
	}

	private async getGlobalState(key: ExtensionGlobalStateKey) {
		return await this.context.globalState.get(key)
	}

	private async updateWorkspaceState(key: ExtensionWorkspaceStateKey, value: any) {
		await this.context.workspaceState.update(key, value)
	}

	private async getWorkspaceState(key: ExtensionWorkspaceStateKey) {
		return await this.context.workspaceState.get(key)
	}

	private async storeSecret(key: ExtensionSecretKey, value: any) {
		await this.context.secrets.store(key, value)
	}

	private async getSecret(key: ExtensionSecretKey) {
		return await this.context.secrets.get(key)
	}
}

export function getNonce() {
	let text = ""
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length))
	}
	return text
}

export function getUri(webview: Webview, extensionUri: Uri, pathList: string[]) {
	return webview.asWebviewUri(Uri.joinPath(extensionUri, ...pathList))
}
