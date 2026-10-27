import type { SessionViewModel } from "@/session";

export type AttentionKind = "approval" | "question" | "completed" | "error";
export interface AttentionChange {
	id: string;
	kind: AttentionKind;
}

/** History hydration is baseline state, not a fresh notification. */
export function attentionChanges(
	previous: SessionViewModel | undefined,
	view: SessionViewModel,
): AttentionChange[] {
	if (previous?.connectionStatus !== "live" || view.connectionStatus !== "live")
		return [];
	const changes: AttentionChange[] = [];
	for (const approval of view.pendingApprovals) {
		if (
			!previous.pendingApprovals.some(
				(old) => old.approvalId === approval.approvalId,
			)
		)
			changes.push({ id: `approval:${approval.approvalId}`, kind: "approval" });
	}
	for (const question of view.pendingQuestions) {
		if (
			!previous.pendingQuestions.some(
				(old) => old.requestId === question.requestId,
			)
		)
			changes.push({ id: `question:${question.requestId}`, kind: "question" });
	}
	if (previous.runStatus !== view.runStatus && view.runStatus === "failed")
		changes.push({
			id: `error:${view.lastRun?.endedAt ?? view.messages.length}`,
			kind: "error",
		});
	if (
		previous.runStatus === "running" &&
		view.runStatus === "completed" &&
		view.pendingPrompts.length === 0
	)
		changes.push({
			id: `completed:${view.lastRun?.endedAt ?? view.messages.length}`,
			kind: "completed",
		});
	return changes;
}
