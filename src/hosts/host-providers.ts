import { WebviewProvider } from "@core/webview"
import { HostBridgeClientProvider } from "./host-provider-types"
import { WebviewProviderType } from "@/shared/webview/types"
import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"

/**
 * A function that creates WebviewProvider instances
 */
export type WebviewProviderCreator = (providerType: WebviewProviderType) => WebviewProvider

export type DiffViewProviderCreator = () => DiffViewProvider

let _webviewProviderCreator: WebviewProviderCreator | undefined
let _diffViewProviderCreator: DiffViewProviderCreator | undefined
let _hostBridgeProvider: HostBridgeClientProvider | undefined

export var isSetup: boolean = false

export function initializeHostProviders(
	webviewProviderCreator: WebviewProviderCreator,
	diffViewProviderCreator: DiffViewProviderCreator,
	hostBridgeProvider: HostBridgeClientProvider,
) {
	_webviewProviderCreator = webviewProviderCreator
	_diffViewProviderCreator = diffViewProviderCreator
	_hostBridgeProvider = hostBridgeProvider
	isSetup = true
}

export function createWebviewProvider(providerType: WebviewProviderType): WebviewProvider {
	if (!_webviewProviderCreator) {
		throw Error("Host providers not initialized")
	}
	return _webviewProviderCreator(providerType)
}

export function createDiffViewProvider(): DiffViewProvider {
	if (!_diffViewProviderCreator) {
		throw Error("Host providers not initialized")
	}
	return _diffViewProviderCreator()
}

export function getHostBridgeProvider(): HostBridgeClientProvider {
	if (!_hostBridgeProvider) {
		throw Error("Host providers not initialized")
	}
	return _hostBridgeProvider
}
