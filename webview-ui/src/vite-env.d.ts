/// <reference types="vite/client" />

// VSCode Webview API type declarations
declare global {
	function acquireVsCodeApi<T = unknown>(): WebviewApi<T>
}

interface WebviewApi<T> {
	getState(): T | undefined
	setState<U extends T | undefined>(state: U): U
	postMessage(message: any): void
}

// Module declaration for vscode-webview
declare module "vscode-webview" {
	export interface WebviewApi<T = unknown> {
		getState(): T | undefined
		setState<U extends T | undefined>(state: U): U
		postMessage(message: any): void
	}
}
