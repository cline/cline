"use client";

import {
	type AgentTeamLiveActivity,
	agentTeamLiveActivityFromLifecycle,
	changesAgentTeamRoster,
	shouldReplaceAgentTeamLiveActivity,
} from "@cline/ui";
import { useEffect, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";

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
	byAgent: ReadonlyMap<string, AgentTeamLiveActivity>;
	rosterRevision: number;
};

const EMPTY: ReadonlyMap<string, AgentTeamLiveActivity> = new Map();

/**
 * Live view of the team rooted at `rootSessionId`, from the `team_progress`
 * events the sidecar forwards: the latest activity per teammate, and a revision
 * that moves whenever a teammate joins or a run starts or ends, so the persisted
 * roster can be re-read at exactly those moments. Events that carry no agent or
 * say nothing about what it is doing are ignored. The state is tagged with its
 * root session so another team's activity can never surface under this one.
 */
export function useTeamProgress(rootSessionId: string | null): {
	activity: ReadonlyMap<string, AgentTeamLiveActivity>;
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
			const lifecycle = payload.lifecycle;
			const activity = agentTeamLiveActivityFromLifecycle({
				agentId:
					typeof lifecycle?.agentId === "string"
						? lifecycle.agentId
						: undefined,
				eventType:
					typeof lifecycle?.eventType === "string" ? lifecycle.eventType : "",
				message:
					typeof lifecycle?.message === "string"
						? lifecycle.message
						: undefined,
			});
			if (!activity) return;
			const { agentId, ...next } = activity;
			const eventType = next.eventType;
			setState((current) => {
				const sameTeam = current.rootSessionId === rootSessionId;
				const previous = sameTeam ? current.byAgent : EMPTY;
				const revision = sameTeam ? current.rosterRevision : 0;
				const replace = shouldReplaceAgentTeamLiveActivity(
					previous.get(agentId),
					next,
				);
				const rosterChanged = changesAgentTeamRoster(eventType);
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
