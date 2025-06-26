import { Channel, createChannel } from "nice-grpc"
import {
	UriServiceClientImpl,
	WatchServiceClientImpl,
	WorkspaceServiceClientImpl,
	EnvServiceClientImpl,
} from "@generated/standalone/host-bridge-clients"
import {
	UriServiceClientInterface,
	WatchServiceClientInterface,
	WorkspaceServiceClientInterface,
	EnvServiceClientInterface,
} from "@generated/hosts/host-bridge-client-types"
import { HostBridgeClientProvider } from "@/hosts/host-provider-types"

/**
 * Manager to hold the gRPC clients for the host bridge. The clients should be re-used to avoid
 * creating a new TCP connection every time a rpc is made.
 */
export class ExternalHostBridgeClientManager implements HostBridgeClientProvider {
	private channel: Channel
	uriServiceClient: UriServiceClientInterface
	watchServiceClient: WatchServiceClientInterface
	workspaceClient: WorkspaceServiceClientInterface
	envClient: EnvServiceClientInterface

	constructor() {
		const address = process.env.HOST_BRIDGE_ADDRESS || "localhost:50052"
		this.channel = createChannel(address)

		this.uriServiceClient = new UriServiceClientImpl(this.channel)
		this.watchServiceClient = new WatchServiceClientImpl(this.channel)
		this.workspaceClient = new WorkspaceServiceClientImpl(this.channel)
		this.envClient = new EnvServiceClientImpl(this.channel)
	}

	public close(): void {
		this.channel.close()
	}
}
