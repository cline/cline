import type { HubEventName } from "@cline/shared";
import type { HubEvent } from "./link";

/** A test's hub event log: each event takes the next sequence and, unless given one, a timestamp a second per sequence. */
export function eventLog() {
	let sequence = 0;
	return (
		event: HubEventName,
		payload: Record<string, unknown> = {},
		sessionId?: string,
		timestamp?: number,
	): HubEvent => {
		sequence += 1;
		return {
			event,
			sequence,
			sessionId,
			timestamp: timestamp ?? sequence * 1000,
			payload,
		};
	};
}
