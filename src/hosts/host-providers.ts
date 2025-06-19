import { WebviewProvider } from "@core/webview"
import { HostBridgeClientProvider } from "./host-provider-types"
import { WebviewProviderType } from "@/shared/webview/types"
import * as vscode from "vscode"

/**
 * A function that creates WebviewProvider instances
 */
export type WebviewProviderCreator = (
	context: vscode.ExtensionContext,
	outputChannel: vscode.OutputChannel,
	providerType: WebviewProviderType,
) => WebviewProvider

let _webviewProviderCreator: WebviewProviderCreator | undefined
let _hostBridgeProvider: HostBridgeClientProvider | undefined

export var isSetup: boolean = false

export function initializeHostProviders(
	webviewProviderCreator: WebviewProviderCreator,
	hostBridgeProvider: HostBridgeClientProvider,
) {
	_webviewProviderCreator = webviewProviderCreator
	_hostBridgeProvider = hostBridgeProvider
	isSetup = true
}

export function createWebviewProvider(
	context: vscode.ExtensionContext,
	outputChannel: vscode.OutputChannel,
	providerType: WebviewProviderType,
): WebviewProvider {
	if (!_webviewProviderCreator) {
		throw Error("Host providers not initialized")
	}
	return _webviewProviderCreator(context, outputChannel, providerType)
}

export function getHostBridgeProvider(): HostBridgeClientProvider {
	if (!_hostBridgeProvider) {
		throw Error("Host providers not initialized")
	}
	return _hostBridgeProvider
}
