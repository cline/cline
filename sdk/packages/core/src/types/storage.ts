import type { TeamRuntimeState, TeamTeammateSpec } from "@cline/shared";
import type {
	TeamEvent,
	TeamRuntimeStateDelta,
} from "../extensions/tools/team";

/**
 * One batched durable write: events to append to the history log plus the
 * entities that changed since the previous batch. Applied atomically.
 */
export interface TeamPersistenceBatch {
	/** Already-compacted durable events (see `toPersistableTeamEvent`). */
	events: Array<{ type: string; payload: unknown }>;
	delta: TeamRuntimeStateDelta;
	teammates: TeamTeammateSpec[];
	/**
	 * Full state accessor for stores that cannot apply deltas (file fallback).
	 * Row-based stores must not call it.
	 */
	getFullState: () => TeamRuntimeState;
}

import type { SessionStatus } from "./common";
import type { SessionRecord } from "./sessions";

export interface SessionStore {
	init(): Promise<void> | void;
	create(record: SessionRecord): Promise<void> | void;
	updateStatus(
		sessionId: string,
		status: SessionStatus,
		exitCode?: number | null,
	): Promise<void> | void;
	update(
		record: Partial<SessionRecord> & { sessionId: string },
	): Promise<void> | void;
	get(
		sessionId: string,
	): Promise<SessionRecord | undefined> | SessionRecord | undefined;
	list(limit?: number): Promise<SessionRecord[]> | SessionRecord[];
	delete(sessionId: string, cascade?: boolean): Promise<boolean> | boolean;
}

export interface TeamStore {
	listTeamNames(): Promise<string[]> | string[];
	readState(
		teamName: string,
	): Promise<TeamRuntimeState | undefined> | TeamRuntimeState | undefined;
	readHistory(teamName: string, limit?: number): Promise<unknown[]> | unknown[];
	loadRuntime(teamName: string):
		| Promise<{
				state?: TeamRuntimeState;
				teammates: TeamTeammateSpec[];
				interruptedRunIds: string[];
		  }>
		| {
				state?: TeamRuntimeState;
				teammates: TeamTeammateSpec[];
				interruptedRunIds: string[];
		  };
	handleTeamEvent(teamName: string, event: TeamEvent): Promise<void> | void;
	/** Preferred write path: incremental, batched, single transaction. */
	persistBatch(
		teamName: string,
		batch: TeamPersistenceBatch,
	): Promise<void> | void;
	/** Full rewrite of a team's state. Kept for callers outside the runtime. */
	persistRuntime(
		teamName: string,
		state: TeamRuntimeState,
		teammates: TeamTeammateSpec[],
	): Promise<void> | void;
	markInProgressRunsInterrupted(
		teamName: string,
		reason: string,
	): Promise<string[]> | string[];
}

export interface ArtifactStore {
	appendHook(sessionId: string, payload: unknown): Promise<void> | void;
	writeMessages(sessionId: string, messages: unknown[]): Promise<void> | void;
}
