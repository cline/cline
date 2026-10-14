import { NOTIFY_MIN_INTERVAL_MS } from "../config";
import type { NeedsYouItem } from "../model/needs-you";

/**
 * Needs-you notifications, sent as the hub's `ui.notify`. Today
 * only the menubar app and the hub dashboard render them; upstream ask U3 is
 * for the desktop and the CLI to render them too.
 *
 * Each session's plugin sandbox notifies only for its own session's approvals
 * and questions, so N open chats never send N copies. Tasks and status rows
 * have no owning sandbox; they wait for a single engine host.
 */

/** The hub's `HubUINotifyPayload`. */
export type NotifyPayload = {
	title: string;
	body: string;
	severity: "info" | "warning" | "error";
	sessionId?: string;
};

export function notificationFor(item: NeedsYouItem): NotifyPayload | undefined {
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
	if (item.kind === "question") {
		return {
			title: "Cline asked you a question",
			body: "Open the chat to answer.",
			severity: "warning",
			sessionId: item.sessionId,
		};
	}
	return undefined;
}

/**
 * Dedupes by item key and allows one notification per interval. Every item
 * offered is marked handled, so one held back by the interval is not sent
 * later: it still shows in Needs you and on the badge.
 */
export class NotifyGate {
	private readonly handled = new Set<string>();
	private last = Number.NEGATIVE_INFINITY;

	constructor(
		private readonly minIntervalMs: number = NOTIFY_MIN_INTERVAL_MS,
		private readonly now: () => number = Date.now,
	) {}

	take(items: readonly NeedsYouItem[]): NotifyPayload | undefined {
		const fresh = items.filter(
			(item) => !this.handled.has(item.key) && notificationFor(item),
		);
		for (const item of fresh) this.handled.add(item.key);
		const first = fresh[0];
		if (!first) return undefined;
		const at = this.now();
		if (at - this.last < this.minIntervalMs) return undefined;
		this.last = at;
		const single = notificationFor(first);
		if (fresh.length === 1 || !single) return single;
		return {
			title: "Cline is waiting on you",
			body: `${fresh.length} approvals or questions in this chat. Open it to answer.`,
			severity: "warning",
			sessionId: single.sessionId,
		};
	}
}
