import { HostProvider, WebviewProviderCreator, DiffViewProviderCreator } from "@/hosts/host-provider"
import { HostBridgeClientProvider } from "@/hosts/host-provider-types"
import { vscodeHostBridgeClient } from "@/hosts/vscode/hostbridge/client/host-grpc-client"

/**
 * Initializes the HostProvider with test defaults.
 * This is a common setup used across multiple test files.
 *
 * @param options Optional overrides for the default test configuration
 */
export function setVscodeHostProviderMock(options?: {
	webviewProviderCreator?: WebviewProviderCreator
	diffViewProviderCreator?: DiffViewProviderCreator
	hostBridgeClient?: HostBridgeClientProvider
	logToChannel?: (message: string) => void
	getCallbackUri?: () => Promise<string>
}) {
	HostProvider.reset()
	HostProvider.initialize(
		options?.webviewProviderCreator ?? (((_) => {}) as WebviewProviderCreator),
		options?.diffViewProviderCreator ?? ((() => {}) as DiffViewProviderCreator),
		options?.hostBridgeClient ?? vscodeHostBridgeClient,
		options?.logToChannel ?? ((_) => {}),
		options?.getCallbackUri ?? (async () => "http://example.com:1234/"),
	)
}
