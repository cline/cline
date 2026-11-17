"use client";

import { AgentApprovalCard } from "@cline/ui";
import { Clock3, ShieldAlert } from "lucide-react";
import {
	FactoryGuidanceApprovalCard,
	isFactoryGuidanceApproval,
} from "./factory-guidance-approval";

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
	// Factory guidance changes get their own confirmation with the Hub's
	// diff; every other tool keeps the generic card.
	const guidanceItems = items.filter(isFactoryGuidanceApproval);
	const toolItems = items.filter((item) => !isFactoryGuidanceApproval(item));
	if (guidanceItems.length === 0) {
		return (
			<GenericToolApprovalPanel
				items={toolItems}
				onApprove={onApprove}
				onReject={onReject}
				pendingActions={pendingActions}
				requestErrors={requestErrors}
			/>
		);
	}
	return (
		<div className="flex flex-col gap-2">
			{guidanceItems.map((item) => (
				<FactoryGuidanceApprovalCard
					error={requestErrors[item.requestId]}
					item={item}
					key={item.requestId}
					onApprove={onApprove}
					onReject={onReject}
					pendingAction={pendingActions[item.requestId]}
				/>
			))}
			{toolItems.length > 0 ? (
				<GenericToolApprovalPanel
					items={toolItems}
					onApprove={onApprove}
					onReject={onReject}
					pendingActions={pendingActions}
					requestErrors={requestErrors}
				/>
			) : null}
		</div>
	);
}

/**
 * An Ask Factory question that needs the user's word: a priority change
 * (Urgent, or a priority the user set) with its from → to line, or adding a
 * project. The Hub writes the question and its one-line summary.
 */
function factoryQuestionApproval(item: ToolApprovalRequestItem):
	| {
			question: string;
			summary: string;
			approveLabel?: string;
			rejectLabel?: string;
	  }
	| undefined {
	const input = item.input as Record<string, unknown> | null | undefined;
	if (typeof input?.question !== "string" || typeof input.summary !== "string")
		return undefined;
	if (item.toolName === "factory_status" && input.action === "priority")
		return { question: input.question, summary: input.summary };
	if (item.toolName === "factory_add_project" && input.action === "add_project")
		return {
			question: input.question,
			summary: input.summary,
			approveLabel: "Add",
			rejectLabel: "Not now",
		};
	return undefined;
}

function GenericToolApprovalPanel({
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
		<section className="rounded-xl border border-amber-400/40 bg-amber-500/5 p-3">
			<div className="flex items-center gap-2 text-sm font-medium text-foreground">
				<ShieldAlert className="h-4 w-4 text-amber-500" />
				Tool approval required
			</div>
			<p className="mt-1 text-xs text-muted-foreground">
				Review each tool call and approve or reject it before execution.
			</p>
			<div className="mt-3 flex flex-col gap-2">
				{items.map((item) => {
					const pendingAction = pendingActions[item.requestId];
					const error = requestErrors[item.requestId];
					const question = factoryQuestionApproval(item);
					return (
						<AgentApprovalCard
							description={
								<>
									Request {item.requestId}
									{item.iteration != null
										? ` · Iteration ${item.iteration}`
										: ""}
								</>
							}
							detail={question?.summary ?? formatApprovalInput(item.input)}
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
							title={question?.question ?? item.toolName}
							approveLabel={question?.approveLabel}
							rejectLabel={question?.rejectLabel}
						/>
					);
				})}
			</div>
		</section>
	);
}
