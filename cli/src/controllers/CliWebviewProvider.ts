/**
 * CLI-specific WebviewProvider implementation
 * Instead of rendering to a webview, this outputs to the terminal
 */

import type * as vscode from "vscode"
import { WebviewProvider } from "@/core/webview"

export class CliWebviewProvider extends WebviewProvider {
	constructor(context: vscode.ExtensionContext) {
		super(context)
	}

	override getWebviewUrl(path: string): string {
		// CLI doesn't have webview URLs
		return `file://${path}`
	}

	override getCspSource(): string {
		return "'self'"
	}

	override isVisible(): boolean {
		// CLI is always "visible"
		return true
	}
}
