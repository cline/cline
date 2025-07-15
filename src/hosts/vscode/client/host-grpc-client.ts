import { createGrpcClient } from "@hosts/vscode/client/host-grpc-client-base"
import { HostBridgeClientProvider } from "@/hosts/host-provider-types"
import * as host from "@shared/proto/index.host"

export const vscodeHostBridgeClient: HostBridgeClientProvider = {
	watchServiceClient: createGrpcClient(host.WatchServiceDefinition),
	workspaceClient: createGrpcClient(host.WorkspaceServiceDefinition),
	envClient: createGrpcClient(host.EnvServiceDefinition),
	windowClient: createGrpcClient(host.WindowServiceDefinition),
	diffClient: createGrpcClient(host.DiffServiceDefinition),
}
