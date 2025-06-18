import { UriServiceClientInterface, WatchServiceClientInterface } from "@/generated/hosts/host-bridge-client-types"
import * as VscodeClient from "./vscode/client/host-grpc-client"
import * as ExternalClient from "@/standalone/host-bridge-client-manager"
const isHostBridgeExternal = process.env.HOST_BRIDGE_ADDRESS !== undefined && process.env.HOST_BRIDGE_ADDRESS !== "vscode"
const Client = isHostBridgeExternal ? ExternalClient : VscodeClient

export const UriServiceClient: UriServiceClientInterface = Client.UriServiceClient
export const WatchServiceClient: WatchServiceClientInterface = Client.WatchServiceClient
