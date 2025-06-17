import { UriServiceClientImpl, WatchServiceClientImpl } from "@/generated/standalone/host-bridge-clients"
import * as host from "@generated/nice-grpc/index.host"
import { GrpcClientType } from "@hosts/vscode/client/host-grpc-client-base"
import { Channel, createChannel } from "nice-grpc"

/**
 * Singleton class to hold the gRPC clients for the host bridge. The clients should be re-used to avoid
 * creating a new TCP connection every time a rpc is made.
 */
class HostBridgeClientManager {
	private static instance: HostBridgeClientManager | null
	private channel: Channel
	uriClient: GrpcClientType<typeof host.UriServiceDefinition>
	watchClient: GrpcClientType<typeof host.WatchServiceDefinition>

	private constructor() {
		const address = process.env.HOST_BRIDGE_ADDRESS || "localhost:50052"
		this.channel = createChannel(address)
		this.uriClient = new UriServiceClientImpl(this.channel)
		this.watchClient = new WatchServiceClientImpl(this.channel)
	}

	public static getInstance(): HostBridgeClientManager {
		if (!HostBridgeClientManager.instance) {
			HostBridgeClientManager.instance = new HostBridgeClientManager()
		}
		return HostBridgeClientManager.instance
	}

	public close(): void {
		this.channel.close()
		HostBridgeClientManager.instance = null
	}
}

const clientManager = HostBridgeClientManager.getInstance()

export const UriServiceClient = clientManager.uriClient
export const WatchServiceClient = clientManager.watchClient
