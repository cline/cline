import { sendDidBecomeVisibleEvent } from "@core/controller/ui/subscribeToDidBecomeVisible"
import { handleMapAgentTaskMessage } from "@core/map/handleMapAgentTask"
import { WebviewProvider } from "@core/webview"
import * as vscode from "vscode"
import { handleGrpcRequest, handleGrpcRequestCancel } from "@/core/controller/grpc-handler"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { handleHydroMapCommand } from "@/services/hydrology/handleHydroMapCommand"
import type { ExtensionMessage } from "@/shared/ExtensionMessage"
import { WebviewMessage } from "@/shared/WebviewMessage"

/*
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/default/weather-webview/src/providers/WeatherViewProvider.ts
https://github.com/KumarVariable/vscode-extension-sidebar-html/blob/master/src/customSidebarViewProvider.ts
*/

export class VscodeWebviewProvider extends WebviewProvider implements vscode.WebviewViewProvider {
	// Used in package.json as the view's id. This value cannot be changed due to how vscode caches
	// views based on their id, and updating the id would break existing instances of the extension.
	public static readonly SIDEBAR_ID = ExtensionRegistryInfo.views.Sidebar

	private webview?: vscode.WebviewView
	private disposables: vscode.Disposable[] = []

	override getWebviewUrl(path: string) {
		if (!this.webview) {
			throw new Error("Webview not initialized")
		}
		const uri = this.webview.webview.asWebviewUri(vscode.Uri.file(path))
		return uri.toString()
	}

	override getCspSource() {
		if (!this.webview) {
			throw new Error("Webview not initialized")
		}
		return this.webview.webview.cspSource
	}

	override isVisible() {
		return this.webview?.visible || false
	}

	public getWebview(): vscode.WebviewView | undefined {
		return this.webview
	}

	/**
	 * Initializes and sets up the webview when it's first created.
	 *
	 * @param webviewView - The sidebar webview view instance to be resolved
	 * @returns A promise that resolves when the webview has been fully initialized
	 */
	public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
		this.webview = webviewView

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,
			localResourceRoots: [vscode.Uri.file(HostProvider.get().extensionFsPath)],
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

		// Listen for when the sidebar becomes visible
		// https://github.com/microsoft/vscode-discussions/discussions/840

		// onDidChangeVisibility is only available on the sidebar webview
		// Otherwise WebviewView and WebviewPanel have all the same properties except for this visibility listener
		// WebviewPanel is not currently used in the extension
		webviewView.onDidChangeVisibility(
			async () => {
				if (this.webview?.visible) {
					await sendDidBecomeVisibleEvent()
				}
			},
			null,
			this.disposables,
		)

		// Listen for when the view is disposed
		// This happens when the user closes the view or when the view is closed programmatically
		webviewView.onDidDispose(
			async () => {
				await this.dispose()
			},
			null,
			this.disposables,
		)

		// Listen for configuration changes
		vscode.workspace.onDidChangeConfiguration(
			async (e) => {
				if (e && e.affectsConfiguration("aihydro.mcpMarketplace.enabled")) {
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
			(message) => {
				this.handleWebviewMessage(message)
			},
			null,
			this.disposables,
		)
	}

	/**
	 * Sets up an event listener to listen for messages passed from the webview context and
	 * executes code based on the message that is received.
	 *
	 * @param webview A reference to the extension webview
	 */
	async handleWebviewMessage(message: WebviewMessage) {
		const postMessageToWebview = (response: ExtensionMessage) => this.postMessageToWebview(response)

		switch (message.type) {
			case "grpc_request": {
				if (message.grpc_request) {
					await handleGrpcRequest(this.controller, postMessageToWebview, message.grpc_request)
				}
				break
			}
			case "grpc_request_cancel": {
				if (message.grpc_request_cancel) {
					await handleGrpcRequestCancel(postMessageToWebview, message.grpc_request_cancel)
				}
				break
			}
			case "invokeCommand": {
				if (message.command) {
					try {
						const result = (await vscode.commands.executeCommand(message.command)) as
							| Record<string, unknown>
							| undefined
						postMessageToWebview({
							type: "commandResult",
							commandResult: { command: message.command, ok: true, ...(result ?? {}) },
						})
					} catch (error) {
						postMessageToWebview({
							type: "commandResult",
							commandResult: { command: message.command, ok: false, message: String(error) },
						})
					}
				}
				break
			}
			case "aihydro-hydro-command": {
				await handleHydroMapCommand(this.controller, message, async (response) => {
					await this.webview?.webview.postMessage(response)
				})
				break
			}
			case "aihydro-map-agent-task": {
				await handleMapAgentTaskMessage(this.controller, message, async (response) => {
					await this.webview?.webview.postMessage(response)
				})
				break
			}
			default: {
				console.error("Received unhandled WebviewMessage type:", JSON.stringify(message))
			}
		}
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
	 * Opens a side-by-side webview panel for the map visualization
	 */
	public async openMapPanel(): Promise<void> {
		// Create a new webview panel for the map
		const panel = vscode.window.createWebviewPanel(
			"aihydroMap", // Identifies the type of the webview
			"AI-Hydro Map", // Title of the panel
			vscode.ViewColumn.Beside, // Show beside the current editor
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.file(HostProvider.get().extensionFsPath)],
			},
		)

		// Set the HTML content for the map panel
		panel.webview.html = this.getMapPanelHtmlContent(panel.webview)

		// Handle messages from the map panel
		panel.webview.onDidReceiveMessage(
			(message) => {
				// Forward map-related messages to the controller
				this.handleWebviewMessage(message)
			},
			null,
			this.disposables,
		)

		// Clean up when the panel is closed
		panel.onDidDispose(
			() => {
				// Panel cleanup if needed
			},
			null,
			this.disposables,
		)
	}

	/**
	 * Generates HTML content for the map panel webview
	 */
	private getMapPanelHtmlContent(webview: vscode.Webview): string {
		// For now, return a simple HTML page that will be enhanced later
		// This will eventually load the full React map component
		const nonce = this.getNonce()
		const cspSource = webview.cspSource

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${cspSource};">
	<title>AI-Hydro Map</title>
	<style>
		body {
			margin: 0;
			padding: 20px;
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			background-color: var(--vscode-editor-background);
		}
		.container {
			max-width: 800px;
			margin: 0 auto;
		}
		h1 {
			color: var(--vscode-foreground);
			margin-bottom: 20px;
		}
		.info {
			padding: 15px;
			background-color: var(--vscode-editor-inactiveSelectionBackground);
			border-radius: 4px;
			margin-bottom: 20px;
		}
		#map-container {
			width: 100%;
			height: 500px;
			background-color: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border);
			border-radius: 4px;
			display: flex;
			align-items: center;
			justify-content: center;
		}
	</style>
</head>
<body>
	<div class="container">
		<h1>🗺️ AI-Hydro Map View</h1>
		<div class="info">
			<p><strong>Map visualization is now available in a side-by-side view!</strong></p>
			<p>This panel will display watershed boundaries, stream networks, and other geospatial data.</p>
		</div>
		<div id="map-container">
			<p>Map visualization will render here</p>
		</div>
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		
		// Example: Listen for map data from the extension
		window.addEventListener('message', event => {
			const message = event.data;
			console.log('Map panel received message:', message);
			// Handle map layer updates here
		});
		
		// Example: Request current map state
		vscode.postMessage({
			type: 'grpc_request',
			grpc_request: {
				service: 'MapService',
				method: 'getMapState'
			}
		});
	</script>
</body>
</html>`
	}

	/**
	 * Generates a nonce for Content Security Policy
	 */
	private getNonce(): string {
		let text = ""
		const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length))
		}
		return text
	}

	override async dispose() {
		// WebviewView doesn't have a dispose method, it's managed by VSCode
		// We just need to clean up our disposables
		while (this.disposables.length) {
			const x = this.disposables.pop()
			if (x) {
				x.dispose()
			}
		}
		super.dispose()
	}
}
