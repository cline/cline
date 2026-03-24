import type {
	RpcChatRunTurnRequest,
	RpcChatStartSessionRequest,
	RpcChatTurnResult,
} from "@clinebot/shared";
import { RpcSessionClient } from "./client.js";

export type RpcRuntimeEvent = {
	sessionId: string;
	eventType: string;
	payload: Record<string, unknown>;
};

export type RpcRuntimeStreamStop = () => void;

export class RpcRuntimeChatClient {
	private client: RpcSessionClient;

	constructor(address = RpcRuntimeChatClient.resolveAddress()) {
		this.client = new RpcSessionClient({ address });
	}

	static resolveAddress(): string {
		return process.env.CLINE_RPC_ADDRESS?.trim() || "127.0.0.1:4317";
	}

	async startSession(config: RpcChatStartSessionRequest): Promise<string> {
		const response = await this.client.startRuntimeSession(config);
		const sessionId = response.sessionId?.trim();
		if (!sessionId) {
			throw new Error("runtime start returned an empty session id");
		}
		return sessionId;
	}

	async sendSession(
		sessionId: string,
		request: RpcChatRunTurnRequest,
	): Promise<{ result?: RpcChatTurnResult; queued?: boolean }> {
		return await this.client.sendRuntimeSession(sessionId, request);
	}

	async abortSession(sessionId: string): Promise<boolean> {
		const response = await this.client.abortRuntimeSession(sessionId);
		return response.applied;
	}

	async stopSession(sessionId: string): Promise<boolean> {
		const response = await this.client.stopRuntimeSession(sessionId);
		return response.applied;
	}

	streamEvents(
		clientId: string,
		sessionIds: string[],
		handlers: {
			onEvent: (event: RpcRuntimeEvent) => void;
			onError: (error: Error) => void;
		},
	): RpcRuntimeStreamStop {
		return this.client.streamEvents(
			{
				clientId,
				sessionIds,
			},
			{
				onEvent: handlers.onEvent,
				onError: handlers.onError,
			},
		);
	}

	close(): void {
		this.client.close();
	}
}
