import { UriServiceClientInterface, WatchServiceClientInterface } from "@generated/hosts/host-bridge-client-types"

/**
 * Callback interface for streaming requests
 */
export interface StreamingCallbacks<T = any> {
	onResponse: (response: T) => void
	onError?: (error: Error) => void
	onComplete?: () => void
}

/**
 * Interface for host bridge client providers
 */
export interface HostBridgeClientProvider {
	UriServiceClient: UriServiceClientInterface
	WatchServiceClient: WatchServiceClientInterface
}

let isSetup = false

// Export the clients directly - they'll be set during initialization
export let UriServiceClient: UriServiceClientInterface
export let WatchServiceClient: WatchServiceClientInterface

export function initializeHostBridgeClient(provider: HostBridgeClientProvider): void {
	UriServiceClient = provider.UriServiceClient
	WatchServiceClient = provider.WatchServiceClient
	isSetup = true
}

export function maybeInitializeHostBridgeClient(provider: HostBridgeClientProvider): void {
	if (isSetup) {
		console.log("Host bridge client already initialized, not re-initializing.")
		return
	}
	initializeHostBridgeClient(provider)
}
