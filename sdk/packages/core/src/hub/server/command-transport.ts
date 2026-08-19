import type {
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
} from "@cline/shared";

export interface HubCommandTransport {
	command(envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
	subscribe(
		clientId: string,
		listener: (event: HubEventEnvelope) => void,
		options?: { sessionId?: string },
	): Promise<() => void> | (() => void);
}
