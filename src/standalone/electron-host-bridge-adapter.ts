import { HostBridgeClientProvider } from "@/hosts/host-provider-types"
import { ElectronHostBridgeProvider } from "./electron-host-bridge-provider"

// Adapter class to convert the ElectronHostBridgeProvider to a HostBridgeClientProvider
class ElectronHostBridgeClientAdapter implements HostBridgeClientProvider {
	watchServiceClient = {} as any
	workspaceClient = {} as any
	envClient = {} as any
	windowClient = {} as any
	terminalClient = {} as any
	commandClient = {} as any

	constructor(private provider: ElectronHostBridgeProvider) {
		// Initialize the client interfaces from the provided host bridge
		this.workspaceClient = provider.workspaceService
		this.windowClient = provider.windowService
		this.terminalClient = provider.terminalService
		this.commandClient = provider.commandService
		this.envClient = provider.envService
		this.watchServiceClient = provider.watchService
	}
}

export { ElectronHostBridgeClientAdapter }
