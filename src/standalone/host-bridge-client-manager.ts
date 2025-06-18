import { Channel, createChannel } from "nice-grpc"
import { UriServiceClientImpl, WatchServiceClientImpl } from "@generated/standalone/host-bridge-clients"
import { UriServiceClientInterface, WatchServiceClientInterface } from "@generated/hosts/host-bridge-client-types"
import { HostBridgeClientProvider } from "@/hosts/host-bridge-client"

/**
 * Singleton class to hold the gRPC clients for the host bridge. The clients should be re-used to avoid
 * creating a new TCP connection every time a rpc is made.
 */
export class ExternalHostBridgeClientManager implements HostBridgeClientProvider {
	private channel: Channel
	UriServiceClient: UriServiceClientInterface
	WatchServiceClient: WatchServiceClientInterface

	constructor() {
		const address = process.env.HOST_BRIDGE_ADDRESS || "localhost:50052"
		this.channel = createChannel(address)

		this.UriServiceClient = new UriServiceClientImpl(this.channel)
		this.WatchServiceClient = new WatchServiceClientImpl(this.channel)
	}

	public close(): void {
		this.channel.close()
	}
}
