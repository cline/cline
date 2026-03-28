import { randomUUID } from "node:crypto";
import { toProtoStruct } from "../proto/serde";
import type { PendingApproval } from "../types";
import { nowIso, safeString } from "./helpers";
import type {
	ListPendingApprovalsRequest,
	ListPendingApprovalsResponse,
	PendingApprovalMessage,
	PublishEventRequest,
	PublishEventResponse,
	RequestToolApprovalRequest,
	RequestToolApprovalResponse,
	RespondToolApprovalRequest,
	RespondToolApprovalResponse,
} from "./proto-types";

const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60_000;

interface ApprovalState extends PendingApproval {
	status: "pending" | "approved" | "rejected";
	reason?: string;
	waiters: Array<
		(result: { decided: boolean; approved: boolean; reason?: string }) => void
	>;
}

export class RuntimeApprovalService {
	private readonly approvals = new Map<string, ApprovalState>();

	constructor(
		private readonly publishEvent: (
			request: PublishEventRequest,
		) => PublishEventResponse,
	) {}

	public async requestToolApproval(
		request: RequestToolApprovalRequest,
	): Promise<RequestToolApprovalResponse> {
		const sessionId = safeString(request.sessionId).trim();
		const toolCallId = safeString(request.toolCallId).trim();
		const toolName = safeString(request.toolName).trim();
		if (!sessionId || !toolCallId || !toolName) {
			throw new Error("sessionId, toolCallId, and toolName are required");
		}

		const approvalId =
			safeString(request.approvalId).trim() || `apr_${randomUUID()}`;
		const existing = this.approvals.get(approvalId);
		if (!existing) {
			const state: ApprovalState = {
				approvalId,
				sessionId,
				taskId: safeString(request.taskId).trim() || undefined,
				toolCallId,
				toolName,
				inputJson: safeString(request.inputJson),
				requesterClientId:
					safeString(request.requesterClientId).trim() || undefined,
				createdAt: nowIso(),
				status: "pending",
				waiters: [],
			};
			this.approvals.set(approvalId, state);
			this.publishEvent({
				eventId: "",
				sessionId,
				taskId: state.taskId,
				eventType: "approval.requested",
				payload: toProtoStruct(state as unknown as Record<string, unknown>),
				sourceClientId: state.requesterClientId,
			});
		}

		const approval = this.approvals.get(approvalId);
		if (!approval) {
			throw new Error("approval state not found");
		}
		if (approval.status === "approved" || approval.status === "rejected") {
			return {
				approvalId,
				decided: true,
				approved: approval.status === "approved",
				reason: approval.reason ?? "",
			};
		}

		const timeoutMs =
			typeof request.timeoutMs === "number" && request.timeoutMs > 0
				? Math.floor(request.timeoutMs)
				: DEFAULT_APPROVAL_TIMEOUT_MS;

		const result = await new Promise<{
			decided: boolean;
			approved: boolean;
			reason?: string;
		}>((resolve) => {
			const timeout = setTimeout(() => {
				resolve({
					decided: false,
					approved: false,
					reason: "Tool approval request timed out",
				});
			}, timeoutMs);
			approval.waiters.push((value) => {
				clearTimeout(timeout);
				resolve(value);
			});
		});

		return {
			approvalId,
			decided: result.decided,
			approved: result.approved,
			reason: result.reason ?? "",
		};
	}

	public respondToolApproval(
		request: RespondToolApprovalRequest,
	): RespondToolApprovalResponse {
		const approvalId = safeString(request.approvalId).trim();
		if (!approvalId) {
			throw new Error("approvalId is required");
		}
		const approval = this.approvals.get(approvalId);
		if (!approval) {
			return { approvalId, applied: false };
		}
		approval.status = request.approved === true ? "approved" : "rejected";
		approval.reason = safeString(request.reason).trim() || undefined;
		const decided = {
			decided: true,
			approved: approval.status === "approved",
			reason: approval.reason,
		};
		for (const waiter of approval.waiters.splice(0)) {
			waiter(decided);
		}
		this.publishEvent({
			eventId: "",
			sessionId: approval.sessionId,
			taskId: approval.taskId,
			eventType: "approval.decided",
			payload: toProtoStruct({
				approvalId,
				approved: decided.approved,
				reason: decided.reason ?? "",
				responderClientId: safeString(request.responderClientId).trim() || "",
			}),
			sourceClientId: safeString(request.responderClientId).trim() || "",
		});
		return { approvalId, applied: true };
	}

	public listPendingApprovals(
		request: ListPendingApprovalsRequest,
	): ListPendingApprovalsResponse {
		const sessionFilter = safeString(request.sessionId).trim();
		const approvals: PendingApprovalMessage[] = [];
		for (const approval of this.approvals.values()) {
			if (approval.status !== "pending") {
				continue;
			}
			if (sessionFilter && approval.sessionId !== sessionFilter) {
				continue;
			}
			approvals.push({
				approvalId: approval.approvalId,
				sessionId: approval.sessionId,
				taskId: approval.taskId ?? "",
				toolCallId: approval.toolCallId,
				toolName: approval.toolName,
				inputJson: approval.inputJson,
				requesterClientId: approval.requesterClientId ?? "",
				createdAt: approval.createdAt,
			});
		}
		approvals.sort((a, b) =>
			(a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
		);
		return { approvals };
	}
}
