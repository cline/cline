import type {
	SessionMessage,
	SessionMessageStatus,
	TeamRuntimeState,
	TeamTeammateSpec,
} from "@cline/shared";
import type { TeamEvent } from "../extensions/tools/team";
import type { SessionStatus } from "./common";
import type { SessionRecord } from "./sessions";

export interface ListInboxOptions {
	unreadOnly?: boolean;
	status?: SessionMessageStatus;
	limit?: number;
}

/**
 * Durable storage for session-to-session messages.
 *
 * Kept synchronous to match `TeamStore`'s local-store implementations, both of
 * which back onto SQLite or the filesystem rather than a network.
 */
export interface SessionMailStore {
	init(): void;
	append(message: SessionMessage): void;
	get(messageId: string): SessionMessage | undefined;
	listInbox(sessionId: string, options?: ListInboxOptions): SessionMessage[];
	markDelivered(messageId: string): void;
	markRead(messageIds: string[]): void;
	markDropped(messageId: string, reason: string): void;
	countSentSince(fromSessionId: string, since: Date): number;
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
