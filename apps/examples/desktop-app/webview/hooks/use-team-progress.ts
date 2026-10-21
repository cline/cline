"use client";

import { useEffect, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import {
	changesTeamRoster,
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
	rosterRevision: number;
};

const EMPTY: ReadonlyMap<string, TeamLiveActivity> = new Map();

/**
 * Live view of the team rooted at `rootSessionId`, from the `team_progress`
 * events the sidecar forwards: the latest activity per teammate, and a revision
 * that moves whenever a teammate joins or a run starts or ends, so the persisted
 * roster can be re-read at exactly those moments. Events that carry no agent or
 * say nothing about what it is doing are ignored. The state is tagged with its
 * root session so another team's activity can never surface under this one.
 */
export function useTeamProgress(rootSessionId: string | null): {
	activity: ReadonlyMap<string, TeamLiveActivity>;
	rosterRevision: number;
} {
	const [state, setState] = useState<LiveState>({
		rootSessionId: null,
		byAgent: EMPTY,
		rosterRevision: 0,
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
				const sameTeam = current.rootSessionId === rootSessionId;
				const previous = sameTeam ? current.byAgent : EMPTY;
				const revision = sameTeam ? current.rosterRevision : 0;
				const replace = shouldReplaceLiveActivity(previous.get(agentId), next);
				const rosterChanged = changesTeamRoster(eventType);
				if (!replace && !rosterChanged && sameTeam) {
					return current;
				}
				let byAgent = previous;
				if (replace) {
					const updated = new Map(previous);
					updated.set(agentId, next);
					byAgent = updated;
				}
				return {
					rootSessionId,
					byAgent,
					rosterRevision: rosterChanged ? revision + 1 : revision,
				};
			});
		});
	}, [rootSessionId]);

	return state.rootSessionId === rootSessionId
		? { activity: state.byAgent, rosterRevision: state.rosterRevision }
		: { activity: EMPTY, rosterRevision: 0 };
}
