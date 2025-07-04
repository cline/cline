import {
	WatchServiceClientInterface,
	WorkspaceServiceClientInterface,
	EnvServiceClientInterface,
	WindowServiceClientInterface,
} from "@generated/hosts/host-bridge-client-types"

/**
 * Interface for host bridge client providers
 */
export interface HostBridgeClientProvider {
	watchServiceClient: WatchServiceClientInterface
	workspaceClient: WorkspaceServiceClientInterface
	envClient: EnvServiceClientInterface
	windowClient: WindowServiceClientInterface
}

/**
 * Callback interface for streaming requests
 */
export interface StreamingCallbacks<T = any> {
	onResponse: (response: T) => void
	onError?: (error: Error) => void
	onComplete?: () => void
}
