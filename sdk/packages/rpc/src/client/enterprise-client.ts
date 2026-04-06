import type {
	RpcEnterpriseAuthenticateRequest,
	RpcEnterpriseAuthenticateResponse,
	RpcEnterpriseStatusRequest,
	RpcEnterpriseStatusResponse,
	RpcEnterpriseSyncRequest,
	RpcEnterpriseSyncResponse,
} from "@clinebot/shared";
import type { ClineGatewayClient } from "../proto/generated/cline/rpc/v1/ClineGateway";
import type { EnterpriseAuthenticateResponse__Output } from "../proto/generated/cline/rpc/v1/EnterpriseAuthenticateResponse";
import type { EnterpriseStatusResponse__Output } from "../proto/generated/cline/rpc/v1/EnterpriseStatusResponse";
import type { EnterpriseSyncResponse__Output } from "../proto/generated/cline/rpc/v1/EnterpriseSyncResponse";
import { fromProtoStruct } from "../proto/serde";
import { unary } from "./unary";

export class EnterpriseClient {
	constructor(private readonly client: ClineGatewayClient) {}

	async authenticate(
		request: RpcEnterpriseAuthenticateRequest,
	): Promise<RpcEnterpriseAuthenticateResponse> {
		const response = await unary<EnterpriseAuthenticateResponse__Output>(
			(callback) => {
				this.client.EnterpriseAuthenticate(
					{
						providerId: request.providerId,
						workspacePath: request.workspacePath,
						rootPath: request.rootPath ?? "",
						projectId: request.projectId ?? "",
						workspaceId: request.workspaceId ?? "",
						organizationId: request.organizationId ?? "",
					},
					callback,
				);
			},
		);
		return {
			providerId: response.providerId ?? "",
			authenticated: response.authenticated === true,
			roles: response.roles ?? [],
			claims: fromProtoStruct(response.claims),
			metadata: fromProtoStruct(response.metadata),
		};
	}

	async sync(
		request: RpcEnterpriseSyncRequest,
	): Promise<RpcEnterpriseSyncResponse> {
		const response = await unary<EnterpriseSyncResponse__Output>((callback) => {
			this.client.EnterpriseSync(
				{
					providerId: request.providerId,
					workspacePath: request.workspacePath,
					rootPath: request.rootPath ?? "",
					projectId: request.projectId ?? "",
					workspaceId: request.workspaceId ?? "",
					organizationId: request.organizationId ?? "",
					useCachedBundle: request.useCachedBundle ?? false,
					hasUseCachedBundle: typeof request.useCachedBundle === "boolean",
				},
				callback,
			);
		});
		return {
			providerId: response.providerId ?? "",
			authenticated: response.authenticated === true,
			hasCachedBundle: response.hasCachedBundle === true,
			appliedConfigVersion: response.appliedConfigVersion?.trim() || undefined,
			roles: response.roles ?? [],
			hasTelemetryOverrides: response.hasTelemetryOverrides === true,
			rulesCount: response.rulesCount ?? 0,
			workflowsCount: response.workflowsCount ?? 0,
			skillsCount: response.skillsCount ?? 0,
			claims: fromProtoStruct(response.claims),
			metadata: fromProtoStruct(response.metadata),
		};
	}

	async getStatus(
		request: RpcEnterpriseStatusRequest,
	): Promise<RpcEnterpriseStatusResponse> {
		const response = await unary<EnterpriseStatusResponse__Output>(
			(callback) => {
				this.client.EnterpriseGetStatus(
					{
						providerId: request.providerId,
						workspacePath: request.workspacePath,
						rootPath: request.rootPath ?? "",
					},
					callback,
				);
			},
		);
		return {
			providerId: response.providerId ?? "",
			authenticated: response.authenticated === true,
			hasCachedBundle: response.hasCachedBundle === true,
			appliedConfigVersion: response.appliedConfigVersion?.trim() || undefined,
			roles: response.roles ?? [],
			hasTelemetryOverrides: response.hasTelemetryOverrides === true,
			rulesCount: response.rulesCount ?? 0,
			workflowsCount: response.workflowsCount ?? 0,
			skillsCount: response.skillsCount ?? 0,
			claims: fromProtoStruct(response.claims),
			metadata: fromProtoStruct(response.metadata),
		};
	}
}
