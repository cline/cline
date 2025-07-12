import { WebviewProvider } from "@core/webview"
import { HostBridgeClientProvider } from "./host-provider-types"
import { WebviewProviderType } from "@/shared/webview/types"

/**
 * A function that creates WebviewProvider instances
 */
export type WebviewProviderCreator = (providerType: WebviewProviderType) => WebviewProvider

let _webviewProviderCreator: WebviewProviderCreator | undefined
let _hostBridgeProvider: HostBridgeClientProvider | undefined
export let binaryInstallPath: String

export var isSetup: boolean = false

export function initializeHostProviders(
	webviewProviderCreator: WebviewProviderCreator,
	hostBridgeProvider: HostBridgeClientProvider,
	binaryInstallPath: string,
) {
	_webviewProviderCreator = webviewProviderCreator
	_hostBridgeProvider = hostBridgeProvider
	binaryInstallPath = binaryInstallPath
	isSetup = true
}

export function createWebviewProvider(providerType: WebviewProviderType): WebviewProvider {
	if (!_webviewProviderCreator) {
		throw Error("Host providers not initialized")
	}
	return _webviewProviderCreator(providerType)
}

export function getHostBridgeProvider(): HostBridgeClientProvider {
	if (!_hostBridgeProvider) {
		throw Error("Host providers not initialized")
	}
	return _hostBridgeProvider
}
