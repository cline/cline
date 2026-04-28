import type {
	HubClientRegistration,
	HubEventEnvelope,
	HubReplyEnvelope,
	HubTransportFrame,
} from "@clinebot/shared";
import { safeJsonParse } from "@clinebot/shared";
import type { HubCommandTransport } from "../transport";

export interface BrowserHubSocketLike {
	send(data: string): void;
	addEventListener(
		type: "message",
		listener: (event: { data: string }) => void,
	): void;
	addEventListener(type: "close", listener: () => void): void;
	removeEventListener(
		type: "message",
		listener: (event: { data: string }) => void,
	): void;
	removeEventListener(type: "close", listener: () => void): void;
}

export class BrowserWebSocketHubAdapter {
	constructor(private readonly transport: HubCommandTransport) {}

	attach(socket: BrowserHubSocketLike): () => void {
		const subscriptions = new Map<string, () => void>();
		const registeredClientIds = new Set<string>();
		let closed = false;

		const sendFrame = (frame: HubTransportFrame): void => {
			try {
				socket.send(JSON.stringify(frame));
			} catch (error) {
				console.error(
					`[hub] failed to send websocket frame: ${
						error instanceof Error
							? error.stack || error.message
							: String(error)
					}`,
				);
			}
		};

		const onEvent = (envelope: HubEventEnvelope): void => {
			sendFrame({ kind: "event", envelope });
		};

		const onMessage = async (event: { data: string }): Promise<void> => {
			try {
				const frame = JSON.parse(event.data) as HubTransportFrame;
				switch (frame.kind) {
					case "command": {
						const reply = await this.transport.command(frame.envelope);
						if (frame.envelope.command === "client.register" && reply.ok) {
							const registration = (frame.envelope.payload ??
								{}) as unknown as HubClientRegistration;
							const clientId =
								registration.clientId?.trim() ||
								frame.envelope.clientId?.trim();
							if (clientId) {
								registeredClientIds.add(clientId);
							}
						} else if (
							frame.envelope.command === "client.unregister" &&
							reply.ok
						) {
							const clientId = frame.envelope.clientId?.trim();
							if (clientId) {
								registeredClientIds.delete(clientId);
							}
						}
						sendFrame({
							kind: "reply",
							envelope: reply satisfies HubReplyEnvelope,
						});
						break;
					}
					case "stream.subscribe": {
						const key = `${frame.clientId}:${frame.sessionId ?? "*"}`;
						if (subscriptions.has(key)) {
							break;
						}
						const unsubscribe = await this.transport.subscribe(
							frame.clientId,
							onEvent,
							{ sessionId: frame.sessionId },
						);
						subscriptions.set(key, unsubscribe);
						break;
					}
					case "stream.unsubscribe": {
						const key = `${frame.clientId}:${frame.sessionId ?? "*"}`;
						subscriptions.get(key)?.();
						subscriptions.delete(key);
						break;
					}
					case "reply":
					case "event":
						break;
				}
			} catch (error) {
				const parsed =
					typeof event.data === "string"
						? safeJsonParse<HubTransportFrame>(event.data)
						: undefined;
				if (!parsed || parsed.kind !== "command") {
					console.error(
						`[hub] rejected malformed websocket frame: ${
							error instanceof Error
								? error.stack || error.message
								: String(error)
						}`,
					);
					return;
				}
				sendFrame({
					kind: "reply",
					envelope: {
						...parsed.envelope,
						ok: false,
						error: {
							code: "command_failed",
							message:
								error instanceof Error ? error.message : "Unknown hub error",
						},
					} satisfies HubReplyEnvelope,
				});
			}
		};

		const onClose = (): void => {
			if (closed) {
				return;
			}
			closed = true;
			for (const unsubscribe of subscriptions.values()) {
				unsubscribe();
			}
			subscriptions.clear();
			for (const clientId of registeredClientIds) {
				void this.transport.command({
					version: "v1",
					command: "client.unregister",
					clientId,
				});
			}
			registeredClientIds.clear();
			socket.removeEventListener("message", onMessage);
			socket.removeEventListener("close", onClose);
		};

		socket.addEventListener("message", onMessage);
		socket.addEventListener("close", onClose);

		return onClose;
	}
}
