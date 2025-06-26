import { Channel, createChannel } from "nice-grpc"
import {
	UriServiceClientImpl,
	WatchServiceClientImpl,
	WorkspaceServiceClientImpl,
} from "@generated/standalone/host-bridge-clients"
import {
	UriServiceClientInterface,
	WatchServiceClientInterface,
	WorkspaceServiceClientInterface,
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

	constructor() {
		const address = process.env.HOST_BRIDGE_ADDRESS || "localhost:50052"
		this.channel = createChannel(address)

		this.uriServiceClient = new UriServiceClientImpl(this.channel)
		this.watchServiceClient = new WatchServiceClientImpl(this.channel)
		this.workspaceClient = new WorkspaceServiceClientImpl(this.channel)
	}

	public close(): void {
		this.channel.close()
	}
}
