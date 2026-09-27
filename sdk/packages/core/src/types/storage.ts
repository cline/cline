import type { TeamRuntimeState, TeamTeammateSpec } from "@cline/shared";
import type { TeamEvent } from "../extensions/tools/team";
import type { SessionStatus } from "./common";
import type { SessionRecord } from "./sessions";

export interface SessionHistoryFilterOptions {
	/** The anchor path of the active workspace */
	anchorPath?: string;
	/**
	 * - "current": Only sessions directly anchored to this workspace
	 * - "hierarchical": Sessions anchored to this workspace OR any of its known sub-clines
	 * - "all": Unfiltered global session history
	 */
	scope?: "current" | "hierarchical" | "all";
	limit?: number;
	offset?: number;
}

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
	listHistory?(
		options?: SessionHistoryFilterOptions,
	): Promise<SessionRecord[]> | SessionRecord[];
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
