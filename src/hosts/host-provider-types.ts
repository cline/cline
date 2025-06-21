import { UriServiceClientInterface, WatchServiceClientInterface } from "@generated/hosts/host-bridge-client-types"

/**
 * Interface for host bridge client providers
 */
export interface HostBridgeClientProvider {
	uriServiceClient: UriServiceClientInterface
	watchServiceClient: WatchServiceClientInterface
}

/**
 * Callback interface for streaming requests
 */
export interface StreamingCallbacks<T = any> {
	onResponse: (response: T) => void
	onError?: (error: Error) => void
	onComplete?: () => void
}
