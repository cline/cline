import path from "node:path"
import { Controller } from "@core/controller/index"
import axios from "axios"
import { readFile } from "fs/promises"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { getNonce } from "./getNonce"

export abstract class WebviewProvider {
	private static instance: WebviewProvider | null = null
	controller: Controller

	constructor(readonly context: vscode.ExtensionContext) {
		WebviewProvider.instance = this

		// Create controller with cache service
		this.controller = new Controller(context)
	}

	async dispose() {
		await this.controller.dispose()
		WebviewProvider.instance = null
	}

	public static getInstance(): WebviewProvider {
		if (!WebviewProvider.instance) {
			throw new Error("WebviewProvider instance not initialized. Make sure to create a WebviewProvider instance first.")
		}
		return WebviewProvider.instance
	}

	public static getVisibleInstance(): WebviewProvider | undefined {
		return WebviewProvider.instance?.isVisible() ? WebviewProvider.instance : undefined
	}

	public static async disposeAllInstances() {
		if (WebviewProvider.instance) {
			await WebviewProvider.instance.dispose()
		}
	}

	/**
	 * Converts a local filesystem path to a URL that can be used within the webview.
	 *
	 * @param path - The local path to convert
	 * @returns A URL that can be used within the webview
	 */
	abstract getWebviewUrl(path: string): string

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
	 * @returns A template string literal containing the HTML that should be
	 * rendered within the webview panel
	 */
	public getHtmlContent(): string {
		// Get the local path to main script run in the webview,
		// then convert it to a url we can use in the webview.
		// The JS file from the React build output
		const scriptUrl = this.getExtensionUrl("webview-ui", "build", "assets", "index.js")

		// The CSS file from the React build output
		const stylesUrl = this.getExtensionUrl("webview-ui", "build", "assets", "index.css")

		// The codicon font from the React build output
		// https://github.com/microsoft/vscode-extension-samples/blob/main/webview-codicons-sample/src/extension.ts
		// we installed this package in the extension so that we can access it how its intended from the extension (the font file is likely bundled in vscode), and we just import the css fileinto our react app we don't have access to it
		// don't forget to add font-src ${webview.cspSource};
		const codiconsUrl = this.getExtensionUrl("node_modules", "@vscode", "codicons", "dist", "codicon.css")

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
				<link rel="stylesheet" type="text/css" href="${stylesUrl}">
				<link href="${codiconsUrl}" rel="stylesheet" />
				<meta http-equiv="Content-Security-Policy" content="default-src 'none';
					connect-src https://*.posthog.com https://*.cline.bot; 
					font-src ${this.getCspSource()} data:; 
					style-src ${this.getCspSource()} 'unsafe-inline'; 
					img-src ${this.getCspSource()} https: data:; 
					script-src 'nonce-${nonce}' 'unsafe-eval';">
				<title>Cline</title>
			</head>
			<body>
				<noscript>You need to enable JavaScript to run this app.</noscript>
				<div id="root"></div>
				<script type="module" nonce="${nonce}" src="${scriptUrl}"></script>
				<script src="http://localhost:8097"></script> 
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
			.catch((_err) => {
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
		} catch (_error) {
			// Only show the error message when in development mode.
			if (process.env.IS_DEV) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message:
						"Cline: Local webview dev server is not running, HMR will not work. Please run 'npm run dev:webview' before launching the extension to enable HMR. Using bundled assets.",
				})
			}

			return this.getHtmlContent()
		}

		const nonce = getNonce()
		const stylesUrl = this.getExtensionUrl("webview-ui", "build", "assets", "index.css")
		const codiconsUrl = this.getExtensionUrl("node_modules", "@vscode", "codicons", "dist", "codicon.css")

		const scriptEntrypoint = "src/main.tsx"
		const scriptUrl = `http://${localServerUrl}/${scriptEntrypoint}`

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
					${process.env.IS_DEV ? '<script src="http://localhost:8097"></script>' : ""}
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
					<meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
					<link rel="stylesheet" type="text/css" href="${stylesUrl}">
					<link href="${codiconsUrl}" rel="stylesheet" />
					<title>Cline</title>
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
	 * A helper function which will get the webview URL of a given file or resource in the extension directory.
	 *
	 * @remarks This URL can be used within a webview's HTML as a link to the
	 * given file/resource.
	 *
	 * @param pathList An array of strings representing the path to a file/resource in the extension directory.
	 * @returns A URL pointing to the file/resource
	 */
	private getExtensionUrl(...pathList: string[]): string {
		const assetPath = path.resolve(HostProvider.get().extensionFsPath, ...pathList)
		return this.getWebviewUrl(assetPath)
	}
}
