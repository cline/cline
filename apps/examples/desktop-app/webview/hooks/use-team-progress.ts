"use client";

import { useEffect, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import type { TeamLiveActivity } from "@/lib/team-activity";

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
 * from the `team_progress` events the sidecar forwards. Heartbeats and other
 * events that carry no agent are ignored. The state is tagged with its root
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
			if (eventType === "run_progress" && message === "heartbeat") return;
			setState((current) => {
				const byAgent = new Map(
					current.rootSessionId === rootSessionId ? current.byAgent : EMPTY,
				);
				byAgent.set(agentId, { eventType, message, at: Date.now() });
				return { rootSessionId, byAgent };
			});
		});
	}, [rootSessionId]);

	return state.rootSessionId === rootSessionId ? state.byAgent : EMPTY;
}
