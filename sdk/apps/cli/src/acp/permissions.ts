import type {
	AgentSideConnection,
	PermissionOption,
	PermissionOptionKind,
	RequestPermissionRequest,
	ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import type { ToolApprovalRequest, ToolApprovalResult } from "@clinebot/shared";
import { buildToolTitle, mapToolKind } from "./tool-utils";

// ---------------------------------------------------------------------------
// Standard permission options presented to the user
// ---------------------------------------------------------------------------

const PERMISSION_OPTIONS: PermissionOption[] = [
	{
		optionId: "allow_once",
		name: "Allow once",
		kind: "allow_once" as PermissionOptionKind,
	},
	{
		optionId: "allow_always",
		name: "Allow always",
		kind: "allow_always" as PermissionOptionKind,
	},
	{
		optionId: "reject_once",
		name: "Reject",
		kind: "reject_once" as PermissionOptionKind,
	},
];

// ---------------------------------------------------------------------------
// Translate a CLI tool approval request into an ACP permission request
// ---------------------------------------------------------------------------

export function translateToolToPermissionRequest(
	request: ToolApprovalRequest,
	sessionId: string,
): RequestPermissionRequest {
	const toolCall: ToolCallUpdate = {
		toolCallId: request.toolCallId,
		title: buildToolTitle(request.toolName, request.input),
		kind: mapToolKind(request.toolName),
		status: "pending",
		rawInput: request.input,
	};

	return {
		sessionId,
		toolCall,
		options: PERMISSION_OPTIONS,
	};
}

// ---------------------------------------------------------------------------
// Interpret the ACP permission response
// ---------------------------------------------------------------------------

export function handlePermissionResponse(
	outcome:
		| {
				outcome: "cancelled";
		  }
		| {
				outcome: "selected";
				optionId: string;
		  },
): ToolApprovalResult {
	if (outcome.outcome === "cancelled") {
		return { approved: false, reason: "Permission request was cancelled" };
	}

	const optionId = outcome.optionId;
	switch (optionId) {
		case "allow_once":
		case "allow_always":
			return { approved: true };
		case "reject_once":
		case "reject_always":
			return { approved: false, reason: "User rejected the tool call" };
		default:
			return {
				approved: false,
				reason: `Unknown permission option: ${optionId}`,
			};
	}
}

// ---------------------------------------------------------------------------
// Combined: request permission from the ACP client and return CLI result
// ---------------------------------------------------------------------------

export async function requestAcpToolApproval(
	conn: AgentSideConnection,
	sessionId: string,
	request: ToolApprovalRequest,
): Promise<ToolApprovalResult> {
	const permissionRequest = translateToolToPermissionRequest(
		request,
		sessionId,
	);

	// Emit a tool_call update with "pending" status before requesting permission
	void conn.sessionUpdate({
		sessionId,
		update: {
			...permissionRequest.toolCall,
			sessionUpdate: "tool_call_update",
		},
	});

	let response: Awaited<ReturnType<AgentSideConnection["requestPermission"]>>;
	try {
		response = await conn.requestPermission(permissionRequest);
	} catch {
		return { approved: false, reason: "Permission request failed" };
	}

	const result = handlePermissionResponse(response.outcome);

	// Emit a tool_call_update reflecting the decision
	void conn.sessionUpdate({
		sessionId,
		update: {
			sessionUpdate: "tool_call_update",
			toolCallId: request.toolCallId,
			status: result.approved ? "in_progress" : "failed",
		},
	});

	return result;
}
