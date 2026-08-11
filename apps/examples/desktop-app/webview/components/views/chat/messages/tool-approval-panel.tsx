"use client";

import { AgentApprovalCard, AgentApprovalGroup } from "@cline/ui";
import { Clock3 } from "lucide-react";

export type ToolApprovalRequestItem = {
	requestId: string;
	sessionId: string;
	createdAt: string;
	toolCallId: string;
	toolName: string;
	input?: unknown;
	iteration?: number;
	agentId?: string;
	conversationId?: string;
};

export function formatApprovalTimestamp(raw: string): string {
	const parsed = new Date(raw);
	if (Number.isNaN(parsed.getTime())) {
		return "Pending now";
	}
	return parsed.toLocaleString();
}

function formatApprovalInput(input: unknown): string {
	if (input == null) {
		return "{}";
	}
	if (typeof input === "string") {
		return input;
	}
	try {
		return JSON.stringify(input, null, 2);
	} catch {
		return String(input);
	}
}

export function ToolApprovalPanel({
	items,
	pendingActions,
	requestErrors,
	onApprove,
	onReject,
}: {
	items: ToolApprovalRequestItem[];
	pendingActions: Record<string, "approving" | "rejecting">;
	requestErrors: Record<string, string>;
	onApprove: (requestId: string) => void;
	onReject: (requestId: string) => void;
}) {
	return (
		<AgentApprovalGroup
			description="Review each tool call and approve or reject it before execution."
			title="Tool approval required"
		>
			{items.map((item) => {
				const pendingAction = pendingActions[item.requestId];
				const error = requestErrors[item.requestId];
				return (
					<AgentApprovalCard
						description={
							<>
								Request {item.requestId}
								{item.iteration != null ? ` · Iteration ${item.iteration}` : ""}
							</>
						}
						detail={formatApprovalInput(item.input)}
						error={error}
						key={item.requestId}
						meta={
							<>
								<Clock3 className="h-3 w-3" />
								{formatApprovalTimestamp(item.createdAt)}
							</>
						}
						onApprove={() => onApprove(item.requestId)}
						onReject={() => onReject(item.requestId)}
						responding={
							pendingAction === "approving"
								? "approve"
								: pendingAction === "rejecting"
									? "reject"
									: undefined
						}
						title={item.toolName}
					/>
				);
			})}
		</AgentApprovalGroup>
	);
}
