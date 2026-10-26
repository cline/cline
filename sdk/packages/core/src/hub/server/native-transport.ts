import type {
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
} from "@cline/shared";
import type {
	HubCommandTransport,
	HubConnectionAuthority,
	HubConnectionContext,
} from "./command-transport";

export interface NativeHubTransport {
	handleCommand(
		envelope: HubCommandEnvelope,
		authority?: HubConnectionAuthority | null,
		connection?: HubConnectionContext,
	): Promise<HubReplyEnvelope>;
	subscribe(
		clientId: string,
		listener: (event: HubEventEnvelope) => void,
		options?: { sessionId?: string },
	): () => void;
	/** See {@link HubCommandTransport.replayEventsAfter}. */
	replayEventsAfter?(
		sinceSequence: number,
		options: { sessionId?: string; limit: number },
	): HubEventEnvelope[];
}

export class NativeHubTransportAdapter implements HubCommandTransport {
	constructor(private readonly transport: NativeHubTransport) {}

	command(
		envelope: HubCommandEnvelope,
		authority?: HubConnectionAuthority | null,
		connection?: HubConnectionContext,
	): Promise<HubReplyEnvelope> {
		return this.transport.handleCommand(envelope, authority, connection);
	}

	subscribe(
		clientId: string,
		listener: (event: HubEventEnvelope) => void,
		options?: { sessionId?: string },
	): () => void {
		return this.transport.subscribe(clientId, listener, options);
	}

	replayEventsAfter(
		sinceSequence: number,
		options: { sessionId?: string; limit: number },
	): HubEventEnvelope[] {
		return this.transport.replayEventsAfter?.(sinceSequence, options) ?? [];
	}
}
