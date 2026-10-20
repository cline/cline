"use client";

import { useEffect, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import {
	shouldReplaceLiveActivity,
	type TeamLiveActivity,
} from "@/lib/team-activity";

type TeamProgressPayload = {
	sessionId?: unknown;
	lifecycle?: {
		agentId?: unknown;
		eventType?: unknown;
		message?: unknown;
	};
};

type LiveState = {
	rootSessionId: string | null;
	byAgent: ReadonlyMap<string, TeamLiveActivity>;
};

const EMPTY: ReadonlyMap<string, TeamLiveActivity> = new Map();

/**
 * Latest live activity per teammate of the team rooted at `rootSessionId`,
 * from the `team_progress` events the sidecar forwards. Events that carry no
 * agent or say nothing about what it is doing are ignored. The state is tagged with its root
 * session so another team's activity can never surface under this one.
 */
export function useTeamProgress(
	rootSessionId: string | null,
): ReadonlyMap<string, TeamLiveActivity> {
	const [state, setState] = useState<LiveState>({
		rootSessionId: null,
		byAgent: EMPTY,
	});

	useEffect(() => {
		if (!rootSessionId) return;
		return desktopClient.subscribe("team_progress", (raw) => {
			const payload = raw as TeamProgressPayload | null;
			if (!payload || payload.sessionId !== rootSessionId) return;
			const agentId = payload.lifecycle?.agentId;
			const eventType = payload.lifecycle?.eventType;
			if (typeof agentId !== "string" || typeof eventType !== "string") return;
			const message =
				typeof payload.lifecycle?.message === "string"
					? payload.lifecycle.message
					: undefined;
			const next = { eventType, message, at: Date.now() };
			setState((current) => {
				const previous =
					current.rootSessionId === rootSessionId ? current.byAgent : EMPTY;
				if (!shouldReplaceLiveActivity(previous.get(agentId), next)) {
					return current;
				}
				const byAgent = new Map(previous);
				byAgent.set(agentId, next);
				return { rootSessionId, byAgent };
			});
		});
	}, [rootSessionId]);

	return state.rootSessionId === rootSessionId ? state.byAgent : EMPTY;
}
