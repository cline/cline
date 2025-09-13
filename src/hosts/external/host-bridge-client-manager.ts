import {
	DiffServiceClientInterface,
	EnvServiceClientInterface,
	WatchServiceClientInterface,
	WindowServiceClientInterface,
	WorkspaceServiceClientInterface,
} from "@generated/hosts/host-bridge-client-types"
import {
	DiffServiceClientImpl,
	EnvServiceClientImpl,
	WatchServiceClientImpl,
	WindowServiceClientImpl,
	WorkspaceServiceClientImpl,
} from "@generated/hosts/standalone/host-bridge-clients"
import { HostBridgeClientProvider } from "@/hosts/host-provider-types"
import { HOSTBRIDGE_PORT } from "@/standalone/protobus-service"

/**
 * Manager to hold the gRPC clients for the host bridge. The clients should be re-used to avoid
 * creating a new TCP connection every time a rpc is made.
 */
export class ExternalHostBridgeClientManager implements HostBridgeClientProvider {
	watchServiceClient: WatchServiceClientInterface
	workspaceClient: WorkspaceServiceClientInterface
	envClient: EnvServiceClientInterface
	windowClient: WindowServiceClientInterface
	diffClient: DiffServiceClientInterface

	constructor() {
		const address = process.env.HOST_BRIDGE_ADDRESS || `localhost:${HOSTBRIDGE_PORT}`

		this.watchServiceClient = new WatchServiceClientImpl(address)
		this.workspaceClient = new WorkspaceServiceClientImpl(address)
		this.envClient = new EnvServiceClientImpl(address)
		this.windowClient = new WindowServiceClientImpl(address)
		this.diffClient = new DiffServiceClientImpl(address)
	}
}
