import type { HubUINotifyPayload } from "@cline/shared";
import { NOTIFY_MIN_INTERVAL_MS } from "../config";
import type { SessionFold } from "../hub/fold";

/**
 * Needs-you notifications, sent as the hub's `ui.notify`; today the menubar
 * app and the hub dashboard render them. Each session's plugin sandbox
 * notifies only for its own session's approvals and questions, so N open
 * chats never send N copies.
 */

export type NotifyPayload = Pick<
	HubUINotifyPayload,
	"title" | "body" | "severity" | "sessionId"
>;

type Waiting = {
	key: string;
	kind: "approval" | "question";
	sessionId: string;
	toolName?: string;
};

/** The session's pending approvals and questions, keyed as Needs you keys them. */
export function waitingOn(session: SessionFold): Waiting[] {
	const { sessionId } = session;
	return [
		...Object.entries(session.pendingApprovals).map(
			([approvalId, pending]): Waiting => ({
				key: `approval:${approvalId}`,
				kind: "approval",
				sessionId,
				toolName: pending.toolName,
			}),
		),
		...Object.keys(session.pendingQuestions).map(
			(requestId): Waiting => ({
				key: `question:${requestId}`,
				kind: "question",
				sessionId,
			}),
		),
	];
}

function notificationFor(item: Waiting): NotifyPayload {
	if (item.kind === "approval") {
		return {
			title: "Cline is waiting for your approval",
			body: item.toolName
				? `To use ${item.toolName}. Open the chat to decide.`
				: "Open the chat to decide.",
			severity: "warning",
			sessionId: item.sessionId,
		};
	}
	return {
		title: "Cline asked you a question",
		body: "Open the chat to answer.",
		severity: "warning",
		sessionId: item.sessionId,
	};
}

/**
 * Dedupes by item key and allows one notification per interval. Every item
 * offered is marked handled, so one held back by the interval, or offered
 * while notifications are off, is not sent later: it still shows in Needs you
 * and on the badge.
 */
export class NotifyGate {
	private readonly handled = new Set<string>();
	private last = Number.NEGATIVE_INFINITY;

	constructor(
		private readonly options: {
			enabled: () => boolean;
			minIntervalMs?: number;
			now?: () => number;
		},
	) {}

	take(items: readonly Waiting[]): NotifyPayload | undefined {
		const fresh = items.filter((item) => !this.handled.has(item.key));
		for (const item of fresh) this.handled.add(item.key);
		const [first] = fresh;
		if (!first || !this.options.enabled()) return undefined;
		const { minIntervalMs = NOTIFY_MIN_INTERVAL_MS, now = Date.now } =
			this.options;
		const at = now();
		if (at - this.last < minIntervalMs) return undefined;
		this.last = at;
		if (fresh.length === 1) return notificationFor(first);
		return {
			title: "Cline is waiting on you",
			body: `${fresh.length} approvals or questions in this chat. Open it to answer.`,
			severity: "warning",
			sessionId: first.sessionId,
		};
	}
}
