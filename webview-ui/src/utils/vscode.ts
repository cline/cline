import { WebviewMessage } from "@shared/WebviewMessage"
import type { WebviewApi } from "vscode-webview"

/**
 * A utility wrapper around the acquireVsCodeApi() function, which enables
 * message passing and state management between the webview and extension
 * contexts.
 *
 * This utility also enables webview code to be run in a web browser-based
 * dev server by using native web browser features that mock the functionality
 * enabled by acquireVsCodeApi.
 */
declare global {
	interface Window {
		__is_standalone__?: boolean
		standalonePostMessage?: (event: any) => void
	}
}

class VSCodeAPIWrapper {
	private readonly vsCodeApi: WebviewApi<unknown> | undefined

	constructor() {
		// Check if the acquireVsCodeApi function exists in the current development
		// context (i.e. VS Code development window or web browser)
		if (typeof acquireVsCodeApi === "function") {
			this.vsCodeApi = acquireVsCodeApi()
		}
	}

	/**
	 * Post a message (i.e. send arbitrary data) to the owner of the webview.
	 *
	 * @remarks When running webview code inside a web browser, postMessage will instead
	 * log the given message to the console.
	 *
	 * @param message Arbitrary data (must be JSON serializable) to send to the extension context.
	 */
	public postMessage(message: WebviewMessage) {
		if (this.vsCodeApi) {
			this.vsCodeApi.postMessage(message)
		} else if (window.__is_standalone__) {
			if (!window.standalonePostMessage) {
				console.warn("Standalone postMessage not found.")
				return
			}
			const json = JSON.stringify(message)
			console.log("Standalone postMessage: " + json.slice(0, 200))
			window.standalonePostMessage(json)
		} else {
			console.log("postMessage fallback: ", message)
		}
	}
}

// Exports class singleton to prevent multiple invocations of acquireVsCodeApi.
export const vscode = new VSCodeAPIWrapper()
