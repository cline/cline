import axios from "axios"
import * as vscode from "vscode"
import { getNonce } from "./getNonce"

import { WebviewProviderType } from "@/shared/webview/types"
import { Controller } from "@core/controller/index"
import { findLast } from "@shared/array"
import { readFile } from "fs/promises"
import path from "node:path"
import { v4 as uuidv4 } from "uuid"
import { Uri } from "vscode"
import { ExtensionMessage } from "@/shared/ExtensionMessage"

export abstract class WebviewProvider {
	public static readonly sideBarId = "claude-dev.SidebarProvider" // used in package.json as the view's id. This value cannot be changed due to how vscode caches views based on their id, and updating the id would break existing instances of the extension.
	public static readonly tabPanelId = "claude-dev.TabPanelProvider"
	private static activeInstances: Set<WebviewProvider> = new Set()
	private static clientIdMap = new Map<WebviewProvider, string>()
	protected disposables: vscode.Disposable[] = []
	controller: Controller
	private clientId: string

	constructor(
		readonly context: vscode.ExtensionContext,
		protected readonly outputChannel: vscode.OutputChannel,
		private readonly providerType: WebviewProviderType,
	) {
		WebviewProvider.activeInstances.add(this)
		this.clientId = uuidv4()
		WebviewProvider.clientIdMap.set(this, this.clientId)
		this.controller = new Controller(context, outputChannel, (message) => this.postMessageToWebview(message), this.clientId)
	}

	// Add a method to get the client ID
	public getClientId(): string {
		return this.clientId
	}

	// Add a static method to get the client ID for a specific instance
	public static getClientIdForInstance(instance: WebviewProvider): string | undefined {
		return WebviewProvider.clientIdMap.get(instance)
	}

	async dispose() {
		while (this.disposables.length) {
			const x = this.disposables.pop()
			if (x) {
				x.dispose()
			}
		}
		await this.controller.dispose()
		WebviewProvider.activeInstances.delete(this)
		// Remove from client ID map
		WebviewProvider.clientIdMap.delete(this)
	}

	public static getVisibleInstance(): WebviewProvider | undefined {
		return findLast(Array.from(this.activeInstances), (instance) => instance.isVisible() === true)
	}

	public static getActiveInstance(): WebviewProvider | undefined {
		return Array.from(this.activeInstances).find((instance) => {
			if (
				instance.getWebview() &&
				instance.getWebview().viewType === "claude-dev.TabPanelProvider" &&
				"active" in instance.getWebview()
			) {
				return instance.getWebview().active === true
			}
			return false
		})
	}

	public static getAllInstances(): WebviewProvider[] {
		return Array.from(this.activeInstances)
	}

	public static getSidebarInstance() {
		return Array.from(this.activeInstances).find(
			(instance) => instance.getWebview() && "onDidChangeVisibility" in instance.getWebview(),
		)
	}

	public static getTabInstances(): WebviewProvider[] {
		return Array.from(this.activeInstances).filter(
			(instance) => instance.getWebview() && "onDidChangeViewState" in instance.getWebview(),
		)
	}

	public static async disposeAllInstances() {
		const instances = Array.from(this.activeInstances)
		for (const instance of instances) {
			await instance.dispose()
		}
	}

	/**
	 * Initializes and sets up the webview when it's first created.
	 *
	 * @param webviewView - The webview view or panel instance to be resolved
	 * @returns A promise that resolves when the webview has been fully initialized
	 */
	abstract resolveWebviewView(webviewView: vscode.WebviewView | vscode.WebviewPanel): Promise<void>

	/**
	 * Sends a message from the extension to the webview.
	 *
	 * @param message - The message to send to the webview
	 * @returns A thenable that resolves to a boolean indicating success, or undefined if the webview is not available
	 */
	abstract postMessageToWebview(message: ExtensionMessage): Thenable<boolean> | undefined

	/**
	 * Gets the current webview instance.
	 *
	 * @returns The webview instance (WebviewView, WebviewPanel, or similar)
	 */
	abstract getWebview(): any

	/**
	 * Converts a local URI to a webview URI that can be used within the webview.
	 *
	 * @param uri - The local URI to convert
	 * @returns A URI that can be used within the webview
	 */
	abstract getWebviewUri(uri: Uri): Uri

	/**
	 * Gets the Content Security Policy source for the webview.
	 *
	 * @returns The CSP source string to be used in the webview's Content-Security-Policy
	 */
	abstract getCspSource(): string

	/**
	 * Checks if the webview is currently visible to the user.
	 *
	 * @returns True if the webview is visible, false otherwise
	 */
	abstract isVisible(): boolean

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
	public getHtmlContent(): string {
		// Get the local path to main script run in the webview,
		// then convert it to a uri we can use in the webview.

		// The CSS file from the React build output
		const stylesUri = this.getExtensionUri("webview-ui", "build", "assets", "index.css")
		// The JS file from the React build output
		const scriptUri = this.getExtensionUri("webview-ui", "build", "assets", "index.js")

		// The codicon font from the React build output
		// https://github.com/microsoft/vscode-extension-samples/blob/main/webview-codicons-sample/src/extension.ts
		// we installed this package in the extension so that we can access it how its intended from the extension (the font file is likely bundled in vscode), and we just import the css fileinto our react app we don't have access to it
		// don't forget to add font-src ${webview.cspSource};
		const codiconsUri = this.getExtensionUri("node_modules", "@vscode", "codicons", "dist", "codicon.css")

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
				<meta http-equiv="Content-Security-Policy" content="default-src 'none';
					connect-src https://*.posthog.com https://*.cline.bot https://*.firebaseauth.com https://*.firebaseio.com https://*.googleapis.com https://*.firebase.com; 
					font-src ${this.getCspSource()} data:; 
					style-src ${this.getCspSource()} 'unsafe-inline'; 
					img-src ${this.getCspSource()} https: data:; 
					script-src 'nonce-${nonce}' 'unsafe-eval';">
				<title>Cline</title>
			</head>
			<body>
				<noscript>You need to enable JavaScript to run this app.</noscript>
				<div id="root"></div>
				 <script type="text/javascript" nonce="${nonce}">
                    // Inject the provider type
                    window.WEBVIEW_PROVIDER_TYPE = ${JSON.stringify(this.providerType)};
                    
                    // Inject the client ID
                    window.clineClientId = "${this.clientId}";
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
	protected async getHMRHtmlContent(): Promise<string> {
		const localPort = await this.getDevServerPort()
		const localServerUrl = `localhost:${localPort}`

		// Check if local dev server is running.
		try {
			await axios.get(`http://${localServerUrl}`)
		} catch (error) {
			vscode.window.showErrorMessage(
				"Cline: Local webview dev server is not running, HMR will not work. Please run 'npm run dev:webview' before launching the extension to enable HMR. Using bundled assets.",
			)

			return this.getHtmlContent()
		}

		const nonce = getNonce()
		const stylesUri = this.getExtensionUri("webview-ui", "build", "assets", "index.css")
		const codiconsUri = this.getExtensionUri("node_modules", "@vscode", "codicons", "dist", "codicon.css")

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
			`font-src ${this.getCspSource()}`,
			`style-src ${this.getCspSource()} 'unsafe-inline' https://* http://${localServerUrl} http://0.0.0.0:${localPort}`,
			`img-src ${this.getCspSource()} https: data:`,
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
					<title>Cline</title>
				</head>
				<body>
					<div id="root"></div>
					<script type="text/javascript" nonce="${nonce}">
						// Inject the provider type
						window.WEBVIEW_PROVIDER_TYPE = ${JSON.stringify(this.providerType)};
						
						// Inject the client ID
						window.clineClientId = "${this.clientId}";
					</script>
					${reactRefresh}
					<script type="module" src="${scriptUri}"></script>
				</body>
			</html>
		`
	}
	/**
	 * A helper function which will get the webview URI of a given file or resource in the extension directory.
	 *
	 * @remarks This URI can be used within a webview's HTML as a link to the
	 * given file/resource.
	 *
	 * @param pathList An array of strings representing the path to a file/resource in the extension directory.
	 * @returns A URI pointing to the file/resource
	 */
	private getExtensionUri(...pathList: string[]): Uri {
		if (!this.getWebview()) {
			throw Error("webview is not initialized.")
		}
		return this.getWebviewUri(Uri.joinPath(this.context.extensionUri, ...pathList))
	}
}
