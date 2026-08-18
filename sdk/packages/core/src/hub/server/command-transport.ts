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
}

export interface HubCommandTransport {
	command(
		envelope: HubCommandEnvelope,
		authority?: HubConnectionAuthority,
	): Promise<HubReplyEnvelope>;
	subscribe(
		clientId: string,
		listener: (event: HubEventEnvelope) => void,
		options?: { sessionId?: string },
	): Promise<() => void> | (() => void);
}
