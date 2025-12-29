import * as vscode from "vscode"
import { Controller } from "@/core/controller"
import { handleGrpcRequest, handleGrpcRequestCancel } from "@/core/controller/grpc-handler"
import { getNonce } from "@/core/webview/getNonce"
import { HostProvider } from "@/hosts/host-provider"
import type { ExtensionMessage } from "@/shared/ExtensionMessage"

/**
 * Manages a standalone settings webview panel that can be opened in a separate VS Code window/tab.
 * This allows users to view and modify settings while keeping the main Cline sidebar visible.
 */
export class VscodeSettingsWebviewPanel {
	private static currentPanel: VscodeSettingsWebviewPanel | undefined
	private readonly panel: vscode.WebviewPanel
	private readonly controller: Controller
	private readonly context: vscode.ExtensionContext
	private disposables: vscode.Disposable[] = []

	/**
	 * Creates or reveals the settings panel.
	 * If a panel already exists, it will be revealed. Otherwise, a new one is created.
	 */
	public static async createOrShow(context: vscode.ExtensionContext, controller: Controller): Promise<void> {
		// If we already have a panel, show it
		if (VscodeSettingsWebviewPanel.currentPanel) {
			VscodeSettingsWebviewPanel.currentPanel.panel.reveal(vscode.ViewColumn.One)
			return
		}

		// Otherwise, create a new panel
		const panel = vscode.window.createWebviewPanel("clineSettings", "Cline Settings", vscode.ViewColumn.One, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.file(HostProvider.get().extensionFsPath)],
		})

		const instance = new VscodeSettingsWebviewPanel(panel, context, controller)
		VscodeSettingsWebviewPanel.currentPanel = instance

		// Initialize the panel after construction
		await instance.initialize()
	}

	/**
	 * Disposes the current panel if it exists.
	 */
	public static dispose(): void {
		VscodeSettingsWebviewPanel.currentPanel?.disposePanel()
	}

	private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, controller: Controller) {
		this.panel = panel
		this.context = context
		this.controller = controller

		// Set the webview's HTML content
		this.updateHtmlContent()

		// Set up message listener
		this.panel.webview.onDidReceiveMessage((message) => this.handleWebviewMessage(message), null, this.disposables)

		// Handle panel disposal
		this.panel.onDidDispose(() => this.disposePanel(), null, this.disposables)

		// Update settings when panel becomes visible
		this.panel.onDidChangeViewState(
			() => {
				if (this.panel.visible) {
					// Post current state to the panel
					this.controller.postStateToWebview()
				}
			},
			null,
			this.disposables,
		)
	}

	/**
	 * Initializes the panel by sending state and navigating to settings.
	 */
	private async initialize(): Promise<void> {
		// Wait a moment for the webview HTML to load
		await new Promise((resolve) => setTimeout(resolve, 200))

		// Get the current state
		const state = await this.controller.getStateToPostToWebview()

		// Modify state to show settings view by default for this panel
		const modifiedState: any = {
			...state,
			// Force this webview to show settings on initialization
			showSettings: true,
			showWelcome: false,
			showHistory: false,
			showMcp: false,
			showAccount: false,
		}

		// Send state update via gRPC response format (what the webview expects)
		await this.panel.webview.postMessage({
			type: "grpc_response",
			grpc_response: {
				request_id: "initial_state",
				message: {
					stateJson: JSON.stringify(modifiedState),
				},
			},
		})
	}

	/**
	 * Updates the HTML content of the webview panel.
	 * Uses the same React app as the sidebar, but with a flag to indicate it's in a separate window.
	 */
	private async updateHtmlContent(): Promise<void> {
		const webview = this.panel.webview

		// Check if we're in development mode for HMR support
		const isDev = this.context.extensionMode === vscode.ExtensionMode.Development

		if (isDev) {
			this.panel.webview.html = await this.getHMRHtmlContent(webview)
		} else {
			this.panel.webview.html = this.getHtmlContent(webview)
		}
	}

	/**
	 * Generates the HTML content for the webview (production mode).
	 */
	private getHtmlContent(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, "webview-ui", "build", "assets", "index.js"),
		)
		const stylesUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, "webview-ui", "build", "assets", "index.css"),
		)
		const codiconsUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, "node_modules", "@vscode", "codicons", "dist", "codicon.css"),
		)

		const nonce = getNonce()

		return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
					<meta name="theme-color" content="#000000">
					<link rel="stylesheet" type="text/css" href="${stylesUri}">
					<link href="${codiconsUri}" rel="stylesheet" />
					<meta http-equiv="Content-Security-Policy" content="default-src 'none';
						connect-src https://*.posthog.com https://*.cline.bot; 
						font-src ${webview.cspSource} data:; 
						style-src ${webview.cspSource} 'unsafe-inline'; 
						img-src ${webview.cspSource} https: data:; 
						script-src 'nonce-${nonce}' 'unsafe-eval';">
					<title>Cline Settings</title>
					<script nonce="${nonce}">
						// Tell the React app this is a settings-only panel
						window.CLINE_SETTINGS_PANEL = true;
						// Store the VS Code API instance that will be acquired by the platform config
						window.CLOSE_CLINE_SETTINGS_PANEL = null;
					</script>
				</head>
				<body>
					<noscript>You need to enable JavaScript to run this app.</noscript>
					<div id="root"></div>
					<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
				</body>
			</html>
		`
	}

	/**
	 * Generates the HTML content for the webview with HMR support (development mode).
	 */
	private async getHMRHtmlContent(webview: vscode.Webview): Promise<string> {
		// Try to read the dev server port
		const DEFAULT_PORT = 25463
		let localPort = DEFAULT_PORT

		try {
			const path = require("path")
			const fs = require("fs/promises")
			const portFilePath = path.join(this.context.extensionPath, "webview-ui", ".vite-port")
			const portFile = await fs.readFile(portFilePath, "utf8")
			localPort = parseInt(portFile.trim()) || DEFAULT_PORT
		} catch (error) {
			// Use default port if file doesn't exist
		}

		const localServerUrl = `localhost:${localPort}`
		const nonce = getNonce()

		const stylesUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, "webview-ui", "build", "assets", "index.css"),
		)
		const codiconsUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, "node_modules", "@vscode", "codicons", "dist", "codicon.css"),
		)

		const scriptUrl = `http://${localServerUrl}/src/main.tsx`

		const reactRefresh = /*html*/ `
			<script nonce="${nonce}" type="module">
				import RefreshRuntime from "http://${localServerUrl}/@react-refresh"
				RefreshRuntime.injectIntoGlobalHook(window)
				window.$RefreshReg$ = () => {}
				window.$RefreshSig$ = () => (type) => type
				window.__vite_plugin_react_preamble_installed__ = true
			</script>
		`

		const csp = [
			"default-src 'none'",
			`font-src ${webview.cspSource}`,
			`style-src ${webview.cspSource} 'unsafe-inline' https://* http://${localServerUrl} http://0.0.0.0:${localPort}`,
			`img-src ${webview.cspSource} https: data:`,
			`script-src 'unsafe-eval' https://* http://${localServerUrl} http://0.0.0.0:${localPort} 'nonce-${nonce}'`,
			`connect-src https://* ws://${localServerUrl} ws://0.0.0.0:${localPort} http://${localServerUrl} http://0.0.0.0:${localPort}`,
		]

		return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<script src="http://localhost:8097"></script>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
					<meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
					<link rel="stylesheet" type="text/css" href="${stylesUri}">
					<link href="${codiconsUri}" rel="stylesheet" />
					<title>Cline Settings</title>
					<script nonce="${nonce}">
						// Tell the React app this is a settings-only panel
						window.CLINE_SETTINGS_PANEL = true;
						// Provide a function to close this panel
						window.CLOSE_CLINE_SETTINGS_PANEL = function() {
							console.log("Closing settings panel via global function");
							const vsCodeApi = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
							if (vsCodeApi) {
								vsCodeApi.postMessage({ type: "dispose_panel" });
							} else {
								console.error("VS Code API not available");
							}
						};
					</script>
				</head>
				<body>
					<div id="root"></div>
					${reactRefresh}
					<script type="module" src="${scriptUrl}"></script>
				</body>
			</html>
		`
	}

	/**
	 * Handles messages received from the webview.
	 */
	private async handleWebviewMessage(message: any): Promise<void> {
		const postMessageToWebview = (response: ExtensionMessage) => this.panel.webview.postMessage(response)

		switch (message.type) {
			case "dispose_panel": {
				// Dispose this panel (same as clicking the X button)
				console.log("Disposing settings panel via Done button")
				this.panel.dispose() // This triggers onDidDispose which calls disposePanel()
				return
			}
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
			default: {
				console.error("Settings panel received unhandled WebviewMessage type:", JSON.stringify(message))
			}
		}
	}

	/**
	 * Disposes the panel and cleans up resources.
	 */
	private disposePanel(): void {
		VscodeSettingsWebviewPanel.currentPanel = undefined

		// Clean up disposables
		while (this.disposables.length) {
			const disposable = this.disposables.pop()
			if (disposable) {
				disposable.dispose()
			}
		}

		// Dispose the panel
		this.panel.dispose()
	}
}
