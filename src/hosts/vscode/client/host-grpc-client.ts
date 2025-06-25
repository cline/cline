import { createGrpcClient } from "@hosts/vscode/client/host-grpc-client-base"
import { HostBridgeClientProvider } from "@/hosts/host-provider-types"
import * as host from "@shared/proto/index.host"

export const vscodeHostBridgeClient: HostBridgeClientProvider = {
	uriServiceClient: createGrpcClient(host.UriServiceDefinition),
	watchServiceClient: createGrpcClient(host.WatchServiceDefinition),
	workspaceClient: createGrpcClient(host.WorkspaceServiceDefinition),
}
