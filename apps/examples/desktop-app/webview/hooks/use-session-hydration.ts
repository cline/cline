import { useEffect, useRef, useState } from "react";
import type { SessionHistoryItem } from "@/lib/session-history";

type HydrationAttempt = { sessionId: string; retryVersion: number };

export function useSessionHydration({
	historySession,
	sessionId,
	hydrateSession,
	retryVersion = 0,
}: {
	historySession?: SessionHistoryItem;
	sessionId: string | null;
	hydrateSession: (session: SessionHistoryItem) => Promise<boolean>;
	retryVersion?: number;
}) {
	const attempt = useRef<HydrationAttempt | null>(null);
	const [outcome, setOutcome] = useState<{
		attempt: HydrationAttempt;
		succeeded: boolean;
	} | null>(null);
	const retry = Boolean(
		outcome?.attempt === attempt.current &&
			!outcome?.succeeded &&
			attempt.current?.retryVersion !== retryVersion,
	);
	const pending =
		historySession &&
		(attempt.current?.sessionId !== historySession.sessionId || retry);

	useEffect(() => {
		if (!historySession) {
			attempt.current = null;
			setOutcome(null);
			return;
		}
		const sameSession = attempt.current?.sessionId === historySession.sessionId;
		if (sameSession && !retry) return;
		const next = { sessionId: historySession.sessionId, retryVersion };
		attempt.current = next;
		setOutcome(null);
		const settle = (succeeded: boolean) => {
			if (attempt.current === next) setOutcome({ attempt: next, succeeded });
		};
		// A newly opened sidebar row may already be running in this pane.
		if (!sameSession && historySession.sessionId === sessionId) settle(true);
		else void hydrateSession(historySession).then(settle, () => settle(false));
	}, [historySession, hydrateSession, retry, retryVersion, sessionId]);

	// A queued question must wait for the new attempt, even before effects run.
	return historySession && !pending && outcome?.attempt === attempt.current
		? outcome.succeeded
		: null;
}
