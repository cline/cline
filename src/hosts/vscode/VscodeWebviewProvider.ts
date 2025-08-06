import { sendDidBecomeVisibleEvent } from "@core/controller/ui/subscribeToDidBecomeVisible"
import { sendThemeEvent } from "@core/controller/ui/subscribeToTheme"
import { WebviewProvider } from "@core/webview"
import { getTheme } from "@integrations/theme/getTheme"
import type { Uri } from "vscode"
import * as vscode from "vscode"
import type { ExtensionMessage } from "@/shared/ExtensionMessage"
import type { WebviewProviderType } from "@/shared/webview/types"
import { HostProvider } from "@/hosts/host-provider"

/*
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/default/weather-webview/src/providers/WeatherViewProvider.ts
https://github.com/KumarVariable/vscode-extension-sidebar-html/blob/master/src/customSidebarViewProvider.ts
*/

export class VscodeWebviewProvider extends WebviewProvider implements vscode.WebviewViewProvider {
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
	override postMessageToWebview(message: ExtensionMessage) {
		return this.webview?.webview.postMessage(message)
	}
	override isVisible() {
		return this.webview?.visible || false
	}
	override getWebview() {
		return this.webview
	}

	override async resolveWebviewView(webviewView: vscode.WebviewView | vscode.WebviewPanel) {
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
				await this.dispose()
			},
			null,
			this.disposables,
		)

		// Listen for configuration changes
		vscode.workspace.onDidChangeConfiguration(
			async (e) => {
				if (e && e.affectsConfiguration("workbench.colorTheme")) {
					// Send theme update via gRPC subscription
					const theme = await getTheme()
					if (theme) {
						await sendThemeEvent(JSON.stringify(theme))
					}
				}
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
			(message) => {
				this.controller.handleWebviewMessage(message)
			},
			null,
			this.disposables,
		)
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
