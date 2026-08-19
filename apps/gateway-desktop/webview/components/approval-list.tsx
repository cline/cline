"use client";

import { Check, ShieldQuestion, X } from "lucide-react";
import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BridgeClient } from "@/lib/bridge-client";
import { createClientRequestId } from "@/lib/composer";
import type { DesktopProjection } from "@shared/projection";

/**
 * Server-initiated approvals. Every attached authorized client sees the
 * same request; the FIRST committed answer wins. A losing answer gets
 * `approval_already_resolved` and the card is dismissed.
 */
export function ApprovalList({
	client,
	projection,
}: {
	client: BridgeClient;
	projection: DesktopProjection;
}) {
	const [lastNotice, setLastNotice] = useState<string | undefined>();

	const resolve = useCallback(
		(requestId: string, approved: boolean) => {
			void client
				.send({
					command: "approval.resolve",
					clientRequestId: createClientRequestId(),
					requestId,
					approved,
				})
				.then(() => setLastNotice(undefined))
				.catch((error: { code?: string; message?: string }) => {
					setLastNotice(
						error.code === "approval_already_resolved"
							? "Another client answered this approval first."
							: (error.message ?? "Approval failed"),
					);
				});
		},
		[client],
	);

	if (projection.approvals.length === 0 && !lastNotice) {
		return null;
	}

	return (
		<div
			className="flex flex-col gap-2 border-t bg-amber-500/5 p-3"
			data-testid="approval-list"
		>
			{lastNotice && (
				<p className="text-xs text-muted-foreground">{lastNotice}</p>
			)}
			{projection.approvals.map((approval) => (
				<div
					className="flex items-center gap-3 rounded-md border border-amber-500/30 bg-card px-3 py-2"
					key={approval.requestId}
				>
					<ShieldQuestion aria-hidden className="size-4 shrink-0 text-amber-400" />
					<div className="min-w-0 flex-1">
						<p className="text-sm font-medium">
							Tool approval requested
							{approval.toolName ? `: ${approval.toolName}` : ""}
						</p>
						<p className="gwd-selectable truncate font-mono text-[10px] text-muted-foreground">
							{approval.requestId}
							{approval.inputPreview ? ` · ${approval.inputPreview}` : ""}
						</p>
					</div>
					<Badge className="border-transparent bg-muted text-[10px] text-muted-foreground">
						first answer wins
					</Badge>
					<Button
						data-testid={`approve-${approval.requestId}`}
						onClick={() => resolve(approval.requestId, true)}
						size="xs"
					>
						<Check aria-hidden className="size-3" />
						Approve
					</Button>
					<Button
						onClick={() => resolve(approval.requestId, false)}
						size="xs"
						variant="destructive"
					>
						<X aria-hidden className="size-3" />
						Deny
					</Button>
				</div>
			))}
		</div>
	);
}
