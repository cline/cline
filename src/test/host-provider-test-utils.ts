import {
	CommentReviewControllerCreator,
	DiffViewProviderCreator,
	HostProvider,
	TerminalManagerCreator,
	WebviewProviderCreator,
} from "@/hosts/host-provider"
import { HostBridgeClientProvider } from "@/hosts/host-provider-types"
import { vscodeHostBridgeClient } from "@/hosts/vscode/hostbridge/client/host-grpc-client"
import { ITerminalManager } from "@/integrations/terminal/types"

/**
 * Initializes the HostProvider with test defaults.
 * This is a common setup used across multiple test files.
 *
 * @param options Optional overrides for the default test configuration
 */
export function setVscodeHostProviderMock(options?: {
	webviewProviderCreator?: WebviewProviderCreator
	diffViewProviderCreator?: DiffViewProviderCreator
	commentReviewControllerCreator?: CommentReviewControllerCreator
	terminalManagerCreator?: TerminalManagerCreator
	hostBridgeClient?: HostBridgeClientProvider
	logToChannel?: (message: string) => void
	getCallbackUri?: () => Promise<string>
	getBinaryLocation?: (name: string) => Promise<string>
	extensionFsPath?: string
	globalStorageFsPath?: string
}) {
	HostProvider.reset()
	HostProvider.initialize(
		options?.webviewProviderCreator ?? ((() => {}) as WebviewProviderCreator),
		options?.diffViewProviderCreator ?? ((() => {}) as DiffViewProviderCreator),
		options?.commentReviewControllerCreator ?? ((() => {}) as CommentReviewControllerCreator),
		options?.terminalManagerCreator ?? ((() => ({}) as ITerminalManager) as TerminalManagerCreator),
		options?.hostBridgeClient ?? vscodeHostBridgeClient,
		options?.logToChannel ?? ((_: string) => {}),
		options?.getCallbackUri ?? (async () => "http://example.com:1234/"),
		options?.getBinaryLocation ?? (async (n: string) => `/mock/path/to/binary/${n}`),
		options?.extensionFsPath ?? "/mock/path/to/extension",
		options?.globalStorageFsPath ?? "/mock/path/to/globalstorage",
	)
}
