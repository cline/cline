import { HostBridgeClientProvider } from "./host-provider-types"

let _hostBridgeProvider: HostBridgeClientProvider | undefined

export var isSetup: boolean = false

export function initialize(hostBridgeProvider: HostBridgeClientProvider) {
	_hostBridgeProvider = hostBridgeProvider
	isSetup = true
}

export function getHostBridgeProvider(): HostBridgeClientProvider {
	if (!_hostBridgeProvider) {
		throw Error("Host providers not initialized")
	}
	return _hostBridgeProvider
}
