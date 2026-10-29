"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { desktopClient } from "@/lib/desktop-client";
import type { SessionHistoryItem } from "@/lib/session-history";
import { eventEnvironmentId } from "@/lib/session-identity";

type SideChatAttention = {
	kind: "ready" | "unknown";
	status: string | null;
	approvals: number;
	questions: number;
};

const RequestSchema = z.object({
	requestId: z.string().min(1),
	sessionId: z.string().min(1),
});
const RequestsSchema = z.array(RequestSchema);
const SessionEventSchema = z.object({ sessionId: z.string().min(1) });
const StatusEventSchema = SessionEventSchema.extend({ status: z.string() });
const EndEventSchema = SessionEventSchema.extend({
	reason: z.string().optional(),
});
const ApprovalEventSchema = SessionEventSchema.extend({
	items: RequestsSchema,
});
const ResolvedQuestionSchema = z.object({ requestId: z.string().min(1) });

type Channel = "approvals" | "questions";
type PendingRequests = {
	ids: Set<string>;
	known: boolean;
	revision: number;
	readId: number;
};
type AttentionEntry = {
	session: Pick<SessionHistoryItem, "sessionId" | "environmentId">;
	status: string | null;
	statusRevision: number;
	statusReadId: number;
	approvals: PendingRequests;
	questions: PendingRequests;
};

const pendingRequests = (): PendingRequests => ({
	ids: new Set(),
	known: false,
	revision: 0,
	readId: 0,
});

/** Keeps hidden side activity visible in the main toolbar. */
export function useSideChatAttention(session: SessionHistoryItem | undefined) {
	const sessionId = session?.sessionId;
	const environmentId = session?.environmentId;
	const [observed, setObserved] = useState<{
		sessionId: string;
		environmentId: string;
		attention: SideChatAttention;
	}>();
	useEffect(() => {
		if (!sessionId || !environmentId) return;
		let disposed = false;
		const entry: AttentionEntry = {
			session: { sessionId, environmentId },
			status: null,
			statusRevision: 0,
			statusReadId: 0,
			approvals: pendingRequests(),
			questions: pendingRequests(),
		};
		const matchesSession = (payload: unknown) => {
			const result = SessionEventSchema.safeParse(payload);
			return (
				result.success &&
				result.data.sessionId === sessionId &&
				eventEnvironmentId(payload) === environmentId
			);
		};
		const publish = () => {
			if (!disposed)
				setObserved({
					sessionId,
					environmentId,
					attention: {
						kind:
							entry.approvals.known &&
							entry.questions.known &&
							entry.status !== null
								? "ready"
								: "unknown",
						status: entry.status,
						approvals: entry.approvals.ids.size,
						questions: entry.questions.ids.size,
					},
				});
		};
		const read = async (channel: Channel): Promise<void> => {
			const state = entry[channel];
			const readId = ++state.readId;
			const revision = state.revision;
			const stillCurrent = () => !disposed && state.readId === readId;
			try {
				const value = await desktopClient.invoke(
					channel === "approvals"
						? "poll_tool_approvals"
						: "poll_ask_questions",
					entry.session,
				);
				if (!stillCurrent()) return;
				// An event may resolve a request while its old snapshot is in flight.
				// Reconcile again rather than resurrect it or lose other pending items.
				if (state.revision !== revision) {
					void read(channel);
					return;
				}
				state.ids = new Set(
					RequestsSchema.parse(value)
						.filter((item) => item.sessionId === entry.session.sessionId)
						.map((item) => item.requestId),
				);
				state.known = true;
			} catch {
				if (!stillCurrent()) return;
				state.known = false;
			}
			publish();
		};
		const readStatus = async () => {
			const readId = ++entry.statusReadId;
			const revision = entry.statusRevision;
			const stillCurrent = () =>
				!disposed &&
				entry.statusReadId === readId &&
				entry.statusRevision === revision;
			try {
				const value = await desktopClient.invoke(
					"get_discovered_session",
					entry.session,
				);
				if (!stillCurrent()) return;
				const result = StatusEventSchema.safeParse(value);
				entry.status =
					result.success && result.data.sessionId === entry.session.sessionId
						? result.data.status
						: null;
			} catch {
				if (!stillCurrent()) return;
				entry.status = null;
			}
			publish();
		};
		const hydrate = () => {
			void readStatus();
			void read("approvals");
			void read("questions");
		};
		const removeQuestion = (payload: unknown) => {
			const result = ResolvedQuestionSchema.safeParse(payload);
			if (!result.success || eventEnvironmentId(payload) !== environmentId)
				return;
			entry.questions.revision++;
			entry.questions.ids.delete(result.data.requestId);
			publish();
		};
		const reconcileSession = (payload: unknown, status: string) => {
			if (!matchesSession(payload)) return;
			entry.status = status;
			entry.statusRevision++;
			publish();
			void read("approvals");
			void read("questions");
		};
		const unsubscribers = [
			desktopClient.subscribe("tool_approval_state", (payload) => {
				const result = ApprovalEventSchema.safeParse(payload);
				if (!result.success || !matchesSession(payload)) return;
				entry.approvals.revision++;
				entry.approvals.ids = new Set(
					result.data.items
						.filter((item) => item.sessionId === entry.session.sessionId)
						.map((item) => item.requestId),
				);
				entry.approvals.known = true;
				publish();
			}),
			desktopClient.subscribe("ask_question_requested", (payload) => {
				const result = RequestSchema.safeParse(payload);
				if (!result.success || !matchesSession(payload)) return;
				entry.questions.revision++;
				entry.questions.ids.add(result.data.requestId);
				publish();
			}),
			desktopClient.subscribe("ask_question_answered", removeQuestion),
			desktopClient.subscribe("ask_question_cancelled", removeQuestion),
			desktopClient.subscribe("chat_session_ended", (payload) => {
				const result = EndEventSchema.safeParse(payload);
				if (result.success)
					reconcileSession(payload, result.data.reason || "completed");
			}),
			desktopClient.subscribe("chat_session_status", (payload) => {
				const result = StatusEventSchema.safeParse(payload);
				if (result.success) reconcileSession(payload, result.data.status);
			}),
			desktopClient.subscribe("session_deleted", (payload) => {
				if (!matchesSession(payload)) return;
				disposed = true;
				setObserved(undefined);
			}),
		];
		publish();
		unsubscribers.push(
			desktopClient.subscribeTransportState((state) => {
				if (state === "connected") {
					hydrate();
					return;
				}
				entry.statusReadId++;
				for (const channel of ["approvals", "questions"] satisfies Channel[]) {
					entry[channel].known = false;
					entry[channel].readId++;
				}
				publish();
			}),
		);
		return () => {
			disposed = true;
			for (const unsubscribe of unsubscribers) unsubscribe();
		};
	}, [sessionId, environmentId]);

	return observed?.sessionId === sessionId &&
		observed?.environmentId === environmentId
		? observed?.attention
		: undefined;
}
