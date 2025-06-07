import axios from "axios"
import * as vscode from "vscode"
import { getNonce } from "./getNonce"
import { getUri } from "./getUri"
import { getTheme } from "@integrations/theme/getTheme"
import { Controller } from "@core/controller/index"
import { findLast } from "@shared/array"
import { readFile } from "fs/promises"
import path from "node:path"
import { WebviewProviderType } from "@/shared/webview/types"
import { sendThemeEvent } from "@core/controller/ui/subscribeToTheme"

/*
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/default/weather-webview/src/providers/WeatherViewProvider.ts
https://github.com/KumarVariable/vscode-extension-sidebar-html/blob/master/src/customSidebarViewProvider.ts
*/

export class WebviewProvider implements vscode.WebviewViewProvider {
	public static readonly sideBarId = "claude-dev.SidebarProvider" // used in package.json as the view's id. This value cannot be changed due to how vscode caches views based on their id, and updating the id would break existing instances of the extension.
	public static readonly tabPanelId = "claude-dev.TabPanelProvider"
	private static activeInstances: Set<WebviewProvider> = new Set()
	public view?: vscode.WebviewView | vscode.WebviewPanel
	private disposables: vscode.Disposable[] = []
	controller: Controller

	constructor(
		readonly context: vscode.ExtensionContext,
		private readonly outputChannel: vscode.OutputChannel,
		private readonly providerType: WebviewProviderType = WebviewProviderType.TAB, // Default to tab provider
	) {
		WebviewProvider.activeInstances.add(this)
		this.controller = new Controller(context, outputChannel, (message) => this.view?.webview.postMessage(message))
	}

	async dispose() {
		if (this.view && "dispose" in this.view) {
			this.view.dispose()
		}
		while (this.disposables.length) {
			const x = this.disposables.pop()
			if (x) {
				x.dispose()
			}
		}
		await this.controller.dispose()
		WebviewProvider.activeInstances.delete(this)
	}

	public static getVisibleInstance(): WebviewProvider | undefined {
		return findLast(Array.from(this.activeInstances), (instance) => instance.view?.visible === true)
	}

	public static getAllInstances(): WebviewProvider[] {
		return Array.from(this.activeInstances)
	}

	public static getSidebarInstance() {
		return Array.from(this.activeInstances).find((instance) => instance.view && "onDidChangeVisibility" in instance.view)
	}

	public static getTabInstances(): WebviewProvider[] {
		return Array.from(this.activeInstances).filter((instance) => instance.view && "onDidChangeViewState" in instance.view)
	}

	public static async disposeAllInstances() {
		const instances = Array.from(this.activeInstances)
		for (const instance of instances) {
			await instance.dispose()
		}
	}

	async resolveWebviewView(webviewView: vscode.WebviewView | vscode.WebviewPanel) {
		this.view = webviewView

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,
			localResourceRoots: [this.context.extensionUri],
		}

		webviewView.webview.html =
			this.context.extensionMode === vscode.ExtensionMode.Development
				? await this.getHMRHtmlContent(webviewView.webview)
				: this.getHtmlContent(webviewView.webview)

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
				() => {
					if (this.view?.visible) {
						this.controller.postMessageToWebview({
							type: "action",
							action: "didBecomeVisible",
						})
					}
				},
				null,
				this.disposables,
			)
		} else if ("onDidChangeVisibility" in webviewView) {
			// sidebar
			webviewView.onDidChangeVisibility(
				() => {
					if (this.view?.visible) {
						this.controller.postMessageToWebview({
							type: "action",
							action: "didBecomeVisible",
						})
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

		// // if the extension is starting a new session, clear previous task state
		// this.clearTask()
		{
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

			this.outputChannel.appendLine("Webview view resolved")

			// Title setting logic removed to allow VSCode to use the container title primarily.
		}
	}

	/**
	 * Defines and returns the HTML that should be rendered within the webview panel.
	 *
	 * @remarks This is also the place where references to the React webview build files
	 * are created and inserted into the webview HTML.
	 *
	 * @param webview A reference to the extension webview
	 * @param extensionUri The URI of the directory containing the extension
	 * @returns A template string literal containing the HTML that should be
	 * rendered within the webview panel
	 */
	private getHtmlContent(webview: vscode.Webview): string {
		// Get the local path to main script run in the webview,
		// then convert it to a uri we can use in the webview.

		// The CSS file from the React build output
		const stylesUri = getUri(webview, this.context.extensionUri, ["webview-ui", "build", "assets", "index.css"])
		// The JS file from the React build output
		const scriptUri = getUri(webview, this.context.extensionUri, ["webview-ui", "build", "assets", "index.js"])

		// The codicon font from the React build output
		// https://github.com/microsoft/vscode-extension-samples/blob/main/webview-codicons-sample/src/extension.ts
		// we installed this package in the extension so that we can access it how its intended from the extension (the font file is likely bundled in vscode), and we just import the css fileinto our react app we don't have access to it
		// don't forget to add font-src ${webview.cspSource};
		const codiconsUri = getUri(webview, this.context.extensionUri, [
			"node_modules",
			"@vscode",
			"codicons",
			"dist",
			"codicon.css",
		])

		const katexCssUri = getUri(webview, this.context.extensionUri, [
			"webview-ui",
			"node_modules",
			"katex",
			"dist",
			"katex.min.css",
		])

		// const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "assets", "main.js"))

		// const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "assets", "reset.css"))
		// const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "assets", "vscode.css"))

		// // Same for stylesheet
		// const stylesheetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "assets", "main.css"))

		// Use a nonce to only allow a specific script to be run.
		/*
				content security policy of your webview to only allow scripts that have a specific nonce
				create a content security policy meta tag so that only loading scripts with a nonce is allowed
				As your extension grows you will likely want to add custom styles, fonts, and/or images to your webview. If you do, you will need to update the content security policy meta tag to explicitly allow for these resources. E.g.
								<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
		- 'unsafe-inline' is required for styles due to vscode-webview-toolkit's dynamic style injection
		- since we pass base64 images to the webview, we need to specify img-src ${webview.cspSource} data:;

				in meta tag we add nonce attribute: A cryptographic nonce (only used once) to allow scripts. The server must generate a unique nonce value each time it transmits a policy. It is critical to provide a nonce that cannot be guessed as bypassing a resource's policy is otherwise trivial.
				*/
		const nonce = getNonce()

		// Tip: Install the es6-string-html VS Code extension to enable code highlighting below
		return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
				<meta name="theme-color" content="#000000">
				<link rel="stylesheet" type="text/css" href="${stylesUri}">
				<link href="${codiconsUri}" rel="stylesheet" />
				<link href="${katexCssUri}" rel="stylesheet" />
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src https://*.posthog.com https://*.firebaseauth.com https://*.firebaseio.com https://*.googleapis.com https://*.firebase.com; font-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}' 'unsafe-eval';">
				<title>Cline</title>
			</head>
			<body>
				<noscript>You need to enable JavaScript to run this app.</noscript>
				<div id="root"></div>
				 <script type="text/javascript" nonce="${nonce}">
                    // Inject the provider type
                    window.WEBVIEW_PROVIDER_TYPE = ${JSON.stringify(this.providerType)};
                </script>
				<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
			</body>
		</html>
		`
	}

	/**
	 * Reads the Vite dev server port from the generated port file to avoid conflicts
	 * Returns a Promise that resolves to the port number
	 * If the file doesn't exist or can't be read, it resolves to the default port
	 */
	private getDevServerPort(): Promise<number> {
		const DEFAULT_PORT = 25463

		const portFilePath = path.join(__dirname, "..", "webview-ui", ".vite-port")

		return readFile(portFilePath, "utf8")
			.then((portFile) => {
				const port = parseInt(portFile.trim()) || DEFAULT_PORT
				console.info(`[getDevServerPort] Using dev server port ${port} from .vite-port file`)

				return port
			})
			.catch((err) => {
				console.warn(
					`[getDevServerPort] Port file not found or couldn't be read at ${portFilePath}, using default port: ${DEFAULT_PORT}`,
				)
				return DEFAULT_PORT
			})
	}

	/**
	 * Connects to the local Vite dev server to allow HMR, with fallback to the bundled assets
	 *
	 * @param webview A reference to the extension webview
	 * @returns A template string literal containing the HTML that should be
	 * rendered within the webview panel
	 */
	private async getHMRHtmlContent(webview: vscode.Webview): Promise<string> {
		const localPort = await this.getDevServerPort()
		const localServerUrl = `localhost:${localPort}`

		// Check if local dev server is running.
		try {
			await axios.get(`http://${localServerUrl}`)
		} catch (error) {
			vscode.window.showErrorMessage(
				"Cline: Local webview dev server is not running, HMR will not work. Please run 'npm run dev:webview' before launching the extension to enable HMR. Using bundled assets.",
			)

			return this.getHtmlContent(webview)
		}

		const nonce = getNonce()
		const stylesUri = getUri(webview, this.context.extensionUri, ["webview-ui", "build", "assets", "index.css"])
		const codiconsUri = getUri(webview, this.context.extensionUri, [
			"node_modules",
			"@vscode",
			"codicons",
			"dist",
			"codicon.css",
		])

		// Get KaTeX resources
		const katexCssUri = getUri(webview, this.context.extensionUri, [
			"webview-ui",
			"node_modules",
			"katex",
			"dist",
			"katex.min.css",
		])

		const scriptEntrypoint = "src/main.tsx"
		const scriptUri = `http://${localServerUrl}/${scriptEntrypoint}`

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
			`font-src ${webview.cspSource} data:`,
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
					<link href="${katexCssUri}" rel="stylesheet" />
					<title>Cline</title>
				</head>
				<body>
					<div id="root"></div>
					<script type="text/javascript" nonce="${nonce}">
						// Inject the provider type
						window.WEBVIEW_PROVIDER_TYPE = ${JSON.stringify(this.providerType)};
					</script>
					${reactRefresh}
					<script type="module" src="${scriptUri}"></script>
				</body>
			</html>
		`
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
}
