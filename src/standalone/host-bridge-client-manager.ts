import { Channel, createChannel, createClient } from "nice-grpc"
import * as host from "@generated/nice-grpc/index.host"

/**
 * Singleton class to hold the gRPC clients for the host bridge. The clients should be re-used to avoid
 * creating a new TCP connection every time a rpc is made.
 */
class HostBridgeClientManager {
	private static instance: HostBridgeClientManager | null
	private channel: Channel
	uriClient: host.UriServiceClient
	//watchClient: host.WatchServiceClient

	private constructor() {
		const address = process.env.HOST_BRIDGE_ADDRESS || "localhost:50052"
		this.channel = createChannel(address)
		this.uriClient = createClient(host.UriServiceDefinition, this.channel)
		//this.watchClient =
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

// TODO(sjf) Replace this with nice-grpc client.
const StubWatchServiceClient = {
	subscribeToFile: function (
		_r: host.SubscribeToFileRequest,
		_h: {
			onResponse?: (response: { type: host.FileChangeEvent_ChangeType }) => void | Promise<void>
			onError?: (error: any) => void
			onComplete?: () => void
		},
	) {
		throw Error("Unimplemented")
	},
}

const clientManager = HostBridgeClientManager.getInstance()

export const UriServiceClient = clientManager.uriClient
export const WatchServiceClient = StubWatchServiceClient
