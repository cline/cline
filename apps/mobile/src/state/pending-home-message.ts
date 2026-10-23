import type { ConnectionDescriptor } from "@/connection";
import type { SessionInputAttachments } from "@/session";

/**
 * A Home prompt crosses one in-app navigation without becoming a URL parameter.
 * Route params are routinely logged and persisted by navigation tooling, so they
 * carry only this opaque id; the actual prompt stays in process memory.
 */

const MAX_PENDING_MESSAGES = 8;

export interface PendingHomeSubmission {
	text: string;
	attachments?: SessionInputAttachments;
}

const messages = new Map<string, PendingHomeSubmission>();
let sequence = 0;

export function stagePendingHomeSubmission(
	submission: PendingHomeSubmission,
): string {
	const id = `home-${Date.now().toString(36)}-${(++sequence).toString(36)}`;
	messages.set(id, submission);
	while (messages.size > MAX_PENDING_MESSAGES) {
		const oldest = messages.keys().next().value;
		if (typeof oldest !== "string") {
			break;
		}
		messages.delete(oldest);
	}
	return id;
}

export function stagePendingHomeMessage(text: string): string {
	return stagePendingHomeSubmission({ text });
}

export function readPendingHomeSubmission(
	id: string,
): PendingHomeSubmission | undefined {
	return messages.get(id);
}

export function readPendingHomeMessage(id: string): string | undefined {
	return messages.get(id)?.text;
}

export function clearPendingHomeMessage(id: string): void {
	messages.delete(id);
}

/** Keep an editable launch's attachment payload aligned with its composer. */
export function updatePendingHomeAttachments(
	id: string,
	userImages: string[],
): void {
	const current = messages.get(id);
	if (!current) return;
	messages.set(id, {
		text: current.text,
		...(userImages.length ? { attachments: { userImages } } : {}),
	});
}

/** Merge a resolved inner session without resurrecting an already-sent prompt. */
export function descriptorWithResolvedSession(
	descriptor: ConnectionDescriptor,
	hubSessionId: string,
	initialMessageConsumed: boolean,
): ConnectionDescriptor {
	const next = { ...descriptor, hubSessionId };
	delete next.allowInitialCreate;
	if (initialMessageConsumed) delete next.pendingInitialMessage;
	return next;
}

/** The one store write needed after consuming a Home launch submission. */
export function descriptorAfterHomeSubmission(
	descriptor: ConnectionDescriptor,
	hubSessionId?: string,
	forcePersistence = false,
): ConnectionDescriptor | undefined {
	if (!descriptor.pendingInitialMessage && !hubSessionId && !forcePersistence) {
		return undefined;
	}
	const next = { ...descriptor };
	delete next.pendingInitialMessage;
	// The initial prompt is cleared before lazy session.create runs. Retain its
	// one-time creation authority until an actual inner session has been pinned.
	if (hubSessionId || next.hubSessionId) delete next.allowInitialCreate;
	if (hubSessionId) next.hubSessionId = hubSessionId;
	return next;
}
