import { handleGrpcRequest, handleGrpcRequestCancel } from "@core/controller/grpc-handler"
import { sendDidBecomeVisibleEvent } from "@core/controller/ui/subscribeToDidBecomeVisible"
import { WebviewProvider } from "@core/webview"
import type { Uri } from "vscode"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionMessage } from "@/shared/ExtensionMessage"
import { ShowMessageType } from "@/shared/proto/host/window"
import { WebviewMessage } from "@/shared/WebviewMessage"
import { WebviewProviderType } from "@/shared/webview/types"

/*
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/default/weather-webview/src/providers/WeatherViewProvider.ts
https://github.com/KumarVariable/vscode-extension-sidebar-html/blob/master/src/customSidebarViewProvider.ts
*/

export class VscodeWebviewProvider extends WebviewProvider implements vscode.WebviewViewProvider {
	// Used in package.json as the view's id. This value cannot be changed due to how vscode caches
	// views based on their id, and updating the id would break existing instances of the extension.
	public static readonly SIDEBAR_ID = "claude-dev.SidebarProvider"
	public static readonly TAB_PANEL_ID = "claude-dev.TabPanelProvider"

	private webview?: vscode.WebviewView | vscode.WebviewPanel
	private disposables: vscode.Disposable[] = []

	constructor(context: vscode.ExtensionContext, providerType: WebviewProviderType) {
		super(context, providerType)
	}

	override getWebviewUri(uri: Uri) {
		if (!this.webview) {
			throw new Error("Webview not initialized")
		}
		return this.webview.webview.asWebviewUri(uri)
	}

	override getCspSource() {
		if (!this.webview) {
			throw new Error("Webview not initialized")
		}
		return this.webview.webview.cspSource
	}

	protected isActive() {
		if (this.webview && this.webview.viewType === VscodeWebviewProvider.TAB_PANEL_ID && "active" in this.webview) {
			return this.webview.active === true
		}
		return false
	}

	override isVisible() {
		return this.webview?.visible || false
	}

	public getWebview(): vscode.WebviewView | vscode.WebviewPanel | undefined {
		return this.webview
	}

	/**
	 * Initializes and sets up the webview when it's first created.
	 *
	 * @param webviewView - The webview view or panel instance to be resolved
	 * @returns A promise that resolves when the webview has been fully initialized
	 */
	public async resolveWebviewView(webviewView: vscode.WebviewView | vscode.WebviewPanel): Promise<void> {
		this.webview = webviewView

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,
			localResourceRoots: [this.context.extensionUri],
		}

		webviewView.webview.html =
			this.context.extensionMode === vscode.ExtensionMode.Development
				? await this.getHMRHtmlContent()
				: this.getHtmlContent()

		// Sets up an event listener to listen for messages passed from the webview view context
		// and executes code based on the message that is received
		this.setWebviewMessageListener(webviewView.webview)

		// Logs show up in bottom panel > Debug Console
		//console.log("registering listener")

		// Listen for when the panel becomes visible
		// https://github.com/microsoft/vscode-discussions/discussions/840
		if ("onDidChangeViewState" in webviewView) {
			// WebviewView and WebviewPanel have all the same properties except for this visibility listener
			// panel
			webviewView.onDidChangeViewState(
				async (e) => {
					if (e?.webviewPanel?.visible && e.webviewPanel?.active) {
						WebviewProvider.setLastActiveControllerId(this.controller.id)
						//  Only send the event if the webview is active (focused)
						await sendDidBecomeVisibleEvent(this.controller.id)
					}
				},
				null,
				this.disposables,
			)
		} else if ("onDidChangeVisibility" in webviewView) {
			// sidebar
			webviewView.onDidChangeVisibility(
				async () => {
					if (this.webview?.visible) {
						WebviewProvider.setLastActiveControllerId(this.controller.id)
						await sendDidBecomeVisibleEvent(this.controller.id)
					}
				},
				null,
				this.disposables,
			)
		}

		// Listen for when the view is disposed
		// This happens when the user closes the view or when the view is closed programmatically
		webviewView.onDidDispose(
			async () => {
				if (WebviewProvider.getLastActiveControllerId() === this.controller.id) {
					WebviewProvider.setLastActiveControllerId(null)
				}
				await this.dispose()
			},
			null,
			this.disposables,
		)

		// Listen for configuration changes
		vscode.workspace.onDidChangeConfiguration(
			async (e) => {
				if (e && e.affectsConfiguration("cline.mcpMarketplace.enabled")) {
					// Update state when marketplace tab setting changes
					await this.controller.postStateToWebview()
				}
			},
			null,
			this.disposables,
		)

		// if the extension is starting a new session, clear previous task state
		this.controller.clearTask()

		HostProvider.get().logToChannel("Webview view resolved")

		// Title setting logic removed to allow VSCode to use the container title primarily.
	}

	/**
	 * Sets up an event listener to listen for messages passed from the webview context and
	 * executes code based on the message that is received.
	 *
	 * IMPORTANT: When passing methods as callbacks in JavaScript/TypeScript, the method's
	 * 'this' context can be lost. This happens because the method is passed as a
	 * standalone function reference, detached from its original object.
	 *
	 * The Problem:
	 * Doing: webview.onDidReceiveMessage(this.controller.handleWebviewMessage)
	 * Would cause 'this' inside handleWebviewMessage to be undefined or wrong,
	 * leading to "TypeError: this.setUserInfo is not a function"
	 *
	 * The Solution:
	 * We wrap the method call in an arrow function, which:
	 * 1. Preserves the lexical scope's 'this' binding
	 * 2. Ensures handleWebviewMessage is called as a method on the controller instance
	 * 3. Maintains access to all controller methods and properties
	 *
	 * Alternative solutions could use .bind() or making handleWebviewMessage an arrow
	 * function property, but this approach is clean and explicit.
	 *
	 * @param webview The webview instance to attach the message listener to
	 */
	private setWebviewMessageListener(webview: vscode.Webview) {
		webview.onDidReceiveMessage(
			async (message: any) => {
				await this.handleWebviewMessage(message)
			},
			undefined,
			this.disposables,
		)
	}

	/**
	 * Sends a message from the extension to the webview.
	 *
	 * @param message - The message to send to the webview
	 * @returns A thenable that resolves to a boolean indicating success, or undefined if the webview is not available
	 */
	private async postMessageToWebview(message: ExtensionMessage): Promise<boolean | undefined> {
		return this.webview?.webview.postMessage(message)
	}

	/**
	 * Handles messages from the webview
	 */
	private handleWebviewMessage = async (message: any) => {
		console.log("Received webview message:", message)

		// 处理返回CAN工具集的请求
		if (message.type === "switchToCanView") {
			// 重新加载webview内容，显示CanView
			if (this.webview) {
				this.webview.webview.html = this.getHtmlContent()
			}
			return
		}

		// Handle gRPC requests
		if (message.type === "grpc_request") {
			// 验证gRPC请求是否包含必要的字段
			const grpcRequest = message.grpc_request || message

			if (!grpcRequest.service || !grpcRequest.method) {
				console.error("Invalid gRPC request: missing service or method", message)
				return
			}

			await handleGrpcRequest(this.controller, this.postMessageToWebview.bind(this), grpcRequest)
		} else if (message.type === "grpc_request_cancel") {
			handleGrpcRequestCancel(this.postMessageToWebview.bind(this), message)
		} else if (message.type === "openInNewTab") {
			// Handle opening content in a new tab
			await this.handleOpenInNewTab(message.command)
		} else {
			console.log("Unknown message type received:", message.type, message)
		}
	}

	/**
	 * Handle opening components in a new tab
	 * @param command The command indicating which component to open
	 */
	private async handleOpenInNewTab(command: string): Promise<void> {
		try {
			// Create a new webview panel
			const lastCol = Math.max(...vscode.window.visibleTextEditors.map((editor) => editor.viewColumn || 0))
			const hasVisibleEditors = vscode.window.visibleTextEditors.length > 0
			const targetCol = hasVisibleEditors ? Math.max(lastCol + 1, 1) : vscode.ViewColumn.Two

			let title = "CAN 工具"
			if (command === "matrix-parse") {
				title = "矩阵报文解析"
			} else if (command === "uds-diag") {
				title = "UDS诊断"
			}

			const panel = vscode.window.createWebviewPanel("cline.canTool", title, targetCol, {
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.joinPath(this.context.extensionUri, "dist"),
					vscode.Uri.joinPath(this.context.extensionUri, "assets"),
				],
			})

			// Set icon for the panel
			panel.iconPath = {
				light: vscode.Uri.joinPath(this.context.extensionUri, "assets", "icons", "robot_panel_light.png"),
				dark: vscode.Uri.joinPath(this.context.extensionUri, "assets", "icons", "robot_panel_dark.png"),
			}

			// Get the webview content
			const webviewContent = await this.getCanToolWebviewContent(command)
			panel.webview.html = webviewContent

			// Handle messages from the webview
			panel.webview.onDidReceiveMessage(
				async (message) => {
					// Forward messages to the main handler
					await this.handleWebviewMessage(message)
				},
				null,
				this.disposables,
			)
		} catch (error) {
			console.error("Error opening CAN tool in new tab:", error)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Failed to open CAN tool: ${error instanceof Error ? error.message : String(error)}`,
			})
		}
	}

	/**
	 * Generate webview content for CAN tools
	 * @param tool The tool to display (matrix-parse or uds-diag)
	 * @returns The HTML content for the webview
	 */
	private async getCanToolWebviewContent(tool: string): Promise<string> {
		// Get the path to the webview dist directory
		const webviewDistPath = vscode.Uri.joinPath(this.context.extensionUri, "dist")
		const webviewDistUri = this.webview?.webview.asWebviewUri(webviewDistPath)

		// Read the index.html file
		const indexPath = vscode.Uri.joinPath(webviewDistPath, "index.html")
		const indexContent = await vscode.workspace.fs.readFile(indexPath)
		let htmlContent = indexContent.toString()

		// Replace the root div with the specific component
		if (tool === "matrix-parse") {
			htmlContent = htmlContent.replace('<div id="root"></div>', `<div id="root" data-can-tool="matrix-parse"></div>`)
		} else if (tool === "uds-diag") {
			htmlContent = htmlContent.replace('<div id="root"></div>', `<div id="root" data-can-tool="uds-diag"></div>`)
		}

		// Add CSP and other security policies
		htmlContent = htmlContent.replace(
			"<head>",
			`<head>
			<meta http-equiv="Content-Security-Policy" 
				content="default-src 'none'; 
				script-src 'unsafe-eval' 'unsafe-inline' vscode-resource: https:; 
				font-src https: data:; 
				img-src vscode-resource: https: data:; 
				style-src 'unsafe-inline' vscode-resource: https:; 
				connect-src https:; 
				frame-src https:;">
			`,
		)

		return htmlContent
	}

	override async dispose() {
		if (this.webview && "dispose" in this.webview) {
			this.webview.dispose()
		}
		while (this.disposables.length) {
			const x = this.disposables.pop()
			if (x) {
				x.dispose()
			}
		}
		super.dispose()
	}
}
