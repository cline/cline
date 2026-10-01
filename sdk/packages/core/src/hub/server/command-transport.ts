import type {
	HubClientRegistration,
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
} from "@cline/shared";

/** Authority captured once by an authenticated transport connection. */
export interface HubConnectionAuthority {
	clientId: string;
	workspaceContext?: HubClientRegistration["workspaceContext"];
	/**
	 * Token-authenticated connections may already bind any workspace at
	 * registration time, so they are also allowed to explicitly request
	 * cross-workspace schedule access (`allWorkspaces` command payloads).
	 */
	crossWorkspace?: boolean;
}

export interface HubCommandTransport {
	command(
		envelope: HubCommandEnvelope,
		/** `null` means the remote connection has not registered yet. */
		authority?: HubConnectionAuthority | null,
	): Promise<HubReplyEnvelope>;
	subscribe(
		clientId: string,
		listener: (event: HubEventEnvelope) => void,
		options?: { sessionId?: string },
	): Promise<() => void> | (() => void);
	/**
	 * Durable events with `sequence > sinceSequence` (scoped when a sessionId
	 * is given), oldest first, bounded by `limit`. Absent on transports
	 * without a durable event log; callers must treat replay as best-effort.
	 */
	replayEventsAfter?(
		sinceSequence: number,
		options: { sessionId?: string; limit: number },
	): HubEventEnvelope[];
}
