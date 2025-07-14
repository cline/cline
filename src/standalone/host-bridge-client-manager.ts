import { Channel, createChannel } from "nice-grpc"
import {
	WatchServiceClientImpl,
	WorkspaceServiceClientImpl,
	EnvServiceClientImpl,
	WindowServiceClientImpl,
	DiffServiceClientImpl,
} from "@generated/standalone/host-bridge-clients"
import {
	WatchServiceClientInterface,
	WorkspaceServiceClientInterface,
	EnvServiceClientInterface,
	WindowServiceClientInterface,
	DiffServiceClientInterface,
} from "@generated/hosts/host-bridge-client-types"
import { HostBridgeClientProvider } from "@/hosts/host-provider-types"

/**
 * Manager to hold the gRPC clients for the host bridge. The clients should be re-used to avoid
 * creating a new TCP connection every time a rpc is made.
 */
export class ExternalHostBridgeClientManager implements HostBridgeClientProvider {
	private channel: Channel
	watchServiceClient: WatchServiceClientInterface
	workspaceClient: WorkspaceServiceClientInterface
	envClient: EnvServiceClientInterface
	windowClient: WindowServiceClientInterface
	diffClient: DiffServiceClientInterface

	constructor() {
		const address = process.env.HOST_BRIDGE_ADDRESS || "localhost:50052"
		this.channel = createChannel(address)

		this.watchServiceClient = new WatchServiceClientImpl(this.channel)
		this.workspaceClient = new WorkspaceServiceClientImpl(this.channel)
		this.envClient = new EnvServiceClientImpl(this.channel)
		this.windowClient = new WindowServiceClientImpl(this.channel)
		this.diffClient = new DiffServiceClientImpl(this.channel)
	}

	public close(): void {
		this.channel.close()
	}
}
