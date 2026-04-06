import type { ClaimSpawnRequestRequest } from "../proto/generated/cline/rpc/v1/ClaimSpawnRequestRequest";
import type { ClaimSpawnRequestResponse__Output } from "../proto/generated/cline/rpc/v1/ClaimSpawnRequestResponse";
import type { ClineGatewayClient } from "../proto/generated/cline/rpc/v1/ClineGateway";
import type { DeleteSessionResponse__Output } from "../proto/generated/cline/rpc/v1/DeleteSessionResponse";
import type { EnqueueSpawnRequestResponse__Output } from "../proto/generated/cline/rpc/v1/EnqueueSpawnRequestResponse";
import type { GetSessionResponse__Output } from "../proto/generated/cline/rpc/v1/GetSessionResponse";
import type { ListPendingApprovalsResponse__Output } from "../proto/generated/cline/rpc/v1/ListPendingApprovalsResponse";
import type { ListSessionsResponse__Output } from "../proto/generated/cline/rpc/v1/ListSessionsResponse";
import type { RequestToolApprovalRequest } from "../proto/generated/cline/rpc/v1/RequestToolApprovalRequest";
import type { RequestToolApprovalResponse__Output } from "../proto/generated/cline/rpc/v1/RequestToolApprovalResponse";
import type { RespondToolApprovalRequest } from "../proto/generated/cline/rpc/v1/RespondToolApprovalRequest";
import type { RespondToolApprovalResponse__Output } from "../proto/generated/cline/rpc/v1/RespondToolApprovalResponse";
import type { UpdateSessionRequest } from "../proto/generated/cline/rpc/v1/UpdateSessionRequest";
import type { UpdateSessionResponse__Output } from "../proto/generated/cline/rpc/v1/UpdateSessionResponse";
import type { UpsertSessionRequest } from "../proto/generated/cline/rpc/v1/UpsertSessionRequest";
import { toProtoStruct } from "../proto/serde";
import type { RpcSessionRow, RpcSessionUpdateInput } from "../types";
import { fromMessage, toMessage } from "./serde";
import { unary } from "./unary";

export class SessionClient {
	constructor(private readonly client: ClineGatewayClient) {}

	async upsertSession(row: RpcSessionRow): Promise<void> {
		await unary((callback) => {
			const request: UpsertSessionRequest = { session: toMessage(row) };
			this.client.UpsertSession(request, callback);
		});
	}

	async getSession(sessionId: string): Promise<RpcSessionRow | undefined> {
		const response = await unary<GetSessionResponse__Output>((callback) => {
			this.client.GetSession({ sessionId }, callback);
		});
		return response.session ? fromMessage(response.session) : undefined;
	}

	async listSessions(input: {
		limit: number;
		parentSessionId?: string;
		status?: string;
	}): Promise<RpcSessionRow[]> {
		const response = await unary<ListSessionsResponse__Output>((callback) => {
			this.client.ListSessions(input, callback);
		});
		return (response.sessions ?? []).map((item) => fromMessage(item));
	}

	async updateSession(
		input: RpcSessionUpdateInput,
	): Promise<{ updated: boolean; statusLock: number }> {
		const request: UpdateSessionRequest = {
			sessionId: input.sessionId,
			status: input.status,
			endedAt: input.endedAt ?? undefined,
			setRunning: input.setRunning,
		};
		if (input.exitCode !== undefined) {
			request.hasExitCode = true;
			request.exitCode = input.exitCode ?? 0;
		}
		if (input.prompt !== undefined) {
			request.hasPrompt = true;
			request.prompt = input.prompt ?? "";
		}
		if (input.metadata !== undefined) {
			request.hasMetadata = true;
			request.metadata = toProtoStruct(input.metadata ?? undefined);
		}
		if (input.parentSessionId !== undefined) {
			request.hasParentSessionId = true;
			request.parentSessionId = input.parentSessionId ?? "";
		}
		if (input.parentAgentId !== undefined) {
			request.hasParentAgentId = true;
			request.parentAgentId = input.parentAgentId ?? "";
		}
		if (input.agentId !== undefined) {
			request.hasAgentId = true;
			request.agentId = input.agentId ?? "";
		}
		if (input.conversationId !== undefined) {
			request.hasConversationId = true;
			request.conversationId = input.conversationId ?? "";
		}
		if (input.expectedStatusLock !== undefined) {
			request.hasExpectedStatusLock = true;
			request.expectedStatusLock = input.expectedStatusLock;
		}
		const response = await unary<UpdateSessionResponse__Output>((callback) => {
			this.client.UpdateSession(request, callback);
		});
		return {
			updated: response.updated === true,
			statusLock: Number(response.statusLock ?? 0),
		};
	}

	async deleteSession(sessionId: string, cascade = false): Promise<boolean> {
		const response = await unary<DeleteSessionResponse__Output>((callback) => {
			this.client.DeleteSession({ sessionId, cascade }, callback);
		});
		return response.deleted === true;
	}

	async enqueueSpawnRequest(input: {
		rootSessionId: string;
		parentAgentId: string;
		task?: string;
		systemPrompt?: string;
	}): Promise<void> {
		await unary<EnqueueSpawnRequestResponse__Output>((callback) => {
			this.client.EnqueueSpawnRequest(input, callback);
		});
	}

	async claimSpawnRequest(
		rootSessionId: string,
		parentAgentId: string,
	): Promise<string | undefined> {
		const response = await unary<ClaimSpawnRequestResponse__Output>(
			(callback) => {
				const request: ClaimSpawnRequestRequest = {
					rootSessionId,
					parentAgentId,
				};
				this.client.ClaimSpawnRequest(request, callback);
			},
		);
		const task = response.item?.task?.trim();
		return task ? task : undefined;
	}

	async requestToolApproval(input: {
		approvalId?: string;
		sessionId: string;
		taskId?: string;
		toolCallId: string;
		toolName: string;
		inputJson?: string;
		requesterClientId?: string;
		timeoutMs?: number;
	}): Promise<{
		approvalId: string;
		decided: boolean;
		approved: boolean;
		reason: string;
	}> {
		const request: RequestToolApprovalRequest = {
			approvalId: input.approvalId,
			sessionId: input.sessionId,
			taskId: input.taskId,
			toolCallId: input.toolCallId,
			toolName: input.toolName,
			inputJson: input.inputJson,
			requesterClientId: input.requesterClientId,
			timeoutMs: input.timeoutMs,
		};
		const response = await unary<RequestToolApprovalResponse__Output>(
			(callback) => {
				this.client.RequestToolApproval(request, callback);
			},
		);
		return {
			approvalId: response.approvalId ?? "",
			decided: response.decided === true,
			approved: response.approved === true,
			reason: response.reason ?? "",
		};
	}

	async respondToolApproval(input: {
		approvalId: string;
		approved: boolean;
		reason?: string;
		responderClientId?: string;
	}): Promise<{ approvalId: string; applied: boolean }> {
		const request: RespondToolApprovalRequest = {
			approvalId: input.approvalId,
			approved: input.approved,
			reason: input.reason,
			responderClientId: input.responderClientId,
		};
		const response = await unary<RespondToolApprovalResponse__Output>(
			(callback) => {
				this.client.RespondToolApproval(request, callback);
			},
		);
		return {
			approvalId: response.approvalId ?? "",
			applied: response.applied === true,
		};
	}

	async listPendingApprovals(sessionId?: string): Promise<
		Array<{
			approvalId: string;
			sessionId: string;
			taskId: string;
			toolCallId: string;
			toolName: string;
			inputJson: string;
			requesterClientId: string;
			createdAt: string;
		}>
	> {
		const response = await unary<ListPendingApprovalsResponse__Output>(
			(callback) => {
				this.client.ListPendingApprovals({ sessionId }, callback);
			},
		);
		return (response.approvals ?? []).map((approval) => ({
			approvalId: approval.approvalId ?? "",
			sessionId: approval.sessionId ?? "",
			taskId: approval.taskId ?? "",
			toolCallId: approval.toolCallId ?? "",
			toolName: approval.toolName ?? "",
			inputJson: approval.inputJson ?? "",
			requesterClientId: approval.requesterClientId ?? "",
			createdAt: approval.createdAt ?? "",
		}));
	}
}
