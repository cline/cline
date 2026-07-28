"use client";

import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WebviewOutboundMessage } from "../../../webview-protocol";

export type PendingApproval = Extract<
	WebviewOutboundMessage,
	{ type: "approval_request" }
> & { responding?: boolean };

function formatApprovalInput(input: unknown): string {
	if (input == null) {
		return "(no input)";
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

export type PendingApprovalsPanelProps = {
	approvals: PendingApproval[];
	onRespond: (approvalId: string, approved: boolean) => void;
};

export function PendingApprovalsPanel({
	approvals,
	onRespond,
}: PendingApprovalsPanelProps) {
	if (approvals.length === 0) {
		return null;
	}
	return (
		<div className="grid max-h-72 gap-2 overflow-auto border-t bg-background/95 px-4 py-3">
			{approvals.map((approval) => (
				<div
					className="grid gap-2 rounded-lg border bg-card p-3 text-sm"
					key={approval.approvalId}
				>
					<div className="flex items-start justify-between gap-3">
						<div className="min-w-0">
							<p className="font-semibold">Approve tool call?</p>
							<p className="break-all text-muted-foreground text-xs">
								{approval.toolName}
							</p>
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<Button
								disabled={approval.responding}
								onClick={() => onRespond(approval.approvalId, false)}
								size="sm"
								type="button"
								variant="destructive"
							>
								<XIcon className="size-4" />
								Reject
							</Button>
							<Button
								disabled={approval.responding}
								onClick={() => onRespond(approval.approvalId, true)}
								size="sm"
								type="button"
							>
								{approval.responding ? (
									<Loader2Icon className="size-4 animate-spin" />
								) : (
									<CheckIcon className="size-4" />
								)}
								Approve
							</Button>
						</div>
					</div>
					<pre className="max-h-32 overflow-auto rounded-md border bg-background p-2 text-[11px]">
						{formatApprovalInput(approval.input)}
					</pre>
				</div>
			))}
		</div>
	);
}
