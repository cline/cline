import { createGrpcClient } from "@hosts/vscode/hostbridge/client/host-grpc-client-base"
import * as host from "@shared/proto/index.host"
import { HostBridgeClientProvider } from "@/hosts/host-provider-types"

export const vscodeHostBridgeClient: HostBridgeClientProvider = {
	workspaceClient: createGrpcClient(host.WorkspaceServiceDefinition),
	envClient: createGrpcClient(host.EnvServiceDefinition),
	windowClient: createGrpcClient(host.WindowServiceDefinition),
	diffClient: createGrpcClient(host.DiffServiceDefinition),
}
