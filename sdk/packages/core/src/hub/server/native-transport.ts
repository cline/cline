import type {
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
} from "@clinebot/shared";
import type { HubCommandTransport } from "./command-transport";

export interface NativeHubTransport {
	handleCommand(envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
	subscribe(
		clientId: string,
		listener: (event: HubEventEnvelope) => void,
		options?: { sessionId?: string },
	): () => void;
}

export class NativeHubTransportAdapter implements HubCommandTransport {
	constructor(private readonly transport: NativeHubTransport) {}

	command(envelope: HubCommandEnvelope): Promise<HubReplyEnvelope> {
		return this.transport.handleCommand(envelope);
	}

	subscribe(
		clientId: string,
		listener: (event: HubEventEnvelope) => void,
		options?: { sessionId?: string },
	): () => void {
		return this.transport.subscribe(clientId, listener, options);
	}
}
