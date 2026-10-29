"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { desktopClient } from "@/lib/desktop-client";
import type { SessionHistoryItem } from "@/lib/session-history";
import { eventEnvironmentId, sessionKey } from "@/lib/session-identity";
import { readSideConversation } from "../../shared/side-conversation";

export type SideChatAttention = {
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
	parentSessionId?: string;
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
export function useSideChatAttention(sessions: readonly SessionHistoryItem[]) {
	const sessionsRef = useRef(sessions);
	sessionsRef.current = sessions;
	const identities = sessions.map(sessionKey).sort().join("\n");
	const [attention, setAttention] = useState<
		ReadonlyMap<string, SideChatAttention>
	>(new Map());

	// biome-ignore lint/correctness/useExhaustiveDependencies: Reconcile on scoped identity changes; status updates arrive through events.
	useEffect(() => {
		let disposed = false;
		const entries = new Map<string, AttentionEntry>(
			sessionsRef.current.map((session) => [
				sessionKey(session),
				{
					session: {
						sessionId: session.sessionId,
						environmentId: session.environmentId,
					},
					parentSessionId: readSideConversation(session.metadata)
						?.parentSessionId,
					status: session.status,
					statusRevision: 0,
					statusReadId: 0,
					approvals: pendingRequests(),
					questions: pendingRequests(),
				},
			]),
		);
		const publish = () => {
			if (disposed) return;
			setAttention(
				new Map(
					[...entries].map(([key, entry]) => [
						key,
						{
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
					]),
				),
			);
		};
		const read = async (
			entry: AttentionEntry,
			channel: Channel,
		): Promise<void> => {
			const state = entry[channel];
			const readId = ++state.readId;
			const revision = state.revision;
			const stillCurrent = () =>
				!disposed &&
				entries.get(sessionKey(entry.session)) === entry &&
				state.readId === readId;
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
					void read(entry, channel);
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
		const readStatus = async (entry: AttentionEntry) => {
			if (!entry.parentSessionId) return;
			const readId = ++entry.statusReadId;
			const revision = entry.statusRevision;
			const stillCurrent = () =>
				!disposed &&
				entries.get(sessionKey(entry.session)) === entry &&
				entry.statusReadId === readId &&
				entry.statusRevision === revision;
			try {
				const value = await desktopClient.invoke("find_side_session", {
					parentSessionId: entry.parentSessionId,
					environmentId: entry.session.environmentId,
				});
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
			for (const entry of entries.values()) {
				void readStatus(entry);
				void read(entry, "approvals");
				void read(entry, "questions");
			}
		};
		const removeQuestion = (payload: unknown) => {
			const result = ResolvedQuestionSchema.safeParse(payload);
			if (!result.success) return;
			for (const entry of entries.values()) {
				if (entry.session.environmentId !== eventEnvironmentId(payload))
					continue;
				entry.questions.revision++;
				entry.questions.ids.delete(result.data.requestId);
			}
			publish();
		};
		const reconcileSession = (payload: unknown, status: string) => {
			const result = SessionEventSchema.safeParse(payload);
			if (!result.success) return;
			const entry = entries.get(
				sessionKey({
					...result.data,
					environmentId: eventEnvironmentId(payload),
				}),
			);
			if (entry) {
				entry.status = status;
				entry.statusRevision++;
				publish();
				void read(entry, "approvals");
				void read(entry, "questions");
			}
		};
		const unsubscribers = [
			desktopClient.subscribe("tool_approval_state", (payload) => {
				const result = ApprovalEventSchema.safeParse(payload);
				if (!result.success) return;
				const entry = entries.get(
					sessionKey({
						sessionId: result.data.sessionId,
						environmentId: eventEnvironmentId(payload),
					}),
				);
				if (!entry) return;
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
				if (!result.success) return;
				const entry = entries.get(
					sessionKey({
						sessionId: result.data.sessionId,
						environmentId: eventEnvironmentId(payload),
					}),
				);
				if (!entry) return;
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
				const result = SessionEventSchema.safeParse(payload);
				if (!result.success) return;
				entries.delete(
					sessionKey({
						...result.data,
						environmentId: eventEnvironmentId(payload),
					}),
				);
				publish();
			}),
		];
		publish();
		unsubscribers.push(
			desktopClient.subscribeTransportState((state) => {
				if (state === "connected") {
					hydrate();
					return;
				}
				for (const entry of entries.values()) {
					entry.statusReadId++;
					for (const channel of [
						"approvals",
						"questions",
					] satisfies Channel[]) {
						entry[channel].known = false;
						entry[channel].readId++;
					}
				}
				publish();
			}),
		);
		return () => {
			disposed = true;
			for (const unsubscribe of unsubscribers) unsubscribe();
		};
	}, [identities]);

	return { attention };
}
