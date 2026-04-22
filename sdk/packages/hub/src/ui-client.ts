import { NodeHubClient } from "@clinebot/core/hub";
import type {
	HubClientRecord,
	HubEventEnvelope,
	HubUINotifyPayload,
	HubUIShowWindowPayload,
	SessionRecord,
} from "@clinebot/shared";

export interface HubUIClientOptions {
	address: string;
	clientId?: string;
	clientType?: string;
	displayName?: string;
}

/**
 * A lightweight hub client for UI/notification concerns.
 * Used by the menu bar app and other UI clients to send/receive
 * UI events (notifications, show window, client tracking).
 */
export class HubUIClient {
	private readonly client: NodeHubClient;

	constructor(options: HubUIClientOptions) {
		this.client = new NodeHubClient({
			url: options.address,
			clientId: options.clientId,
			clientType: options.clientType ?? "hub-ui-client",
			displayName: options.displayName ?? "hub ui client",
		});
	}

	async connect(): Promise<void> {
		await this.client.connect();
	}

	close(): void {
		this.client.close();
	}

	getClientId(): string {
		return this.client.getClientId();
	}

	/**
	 * Send a notification request to the hub.
	 * The hub will broadcast a "ui.notify" event to all subscribers (e.g. the menu bar app).
	 */
	async sendNotify(payload: HubUINotifyPayload): Promise<void> {
		await this.client.command(
			"ui.notify",
			payload as unknown as Record<string, unknown>,
		);
	}

	/**
	 * Request the hub to broadcast a "ui.show_window" event to all subscribers.
	 */
	async sendShowWindow(payload?: HubUIShowWindowPayload): Promise<void> {
		await this.client.command(
			"ui.show_window",
			(payload ?? {}) as Record<string, unknown>,
		);
	}

	async listClients(): Promise<HubClientRecord[]> {
		const reply = await this.client.command("client.list");
		return Array.isArray(reply.payload?.clients)
			? (reply.payload.clients as HubClientRecord[])
			: [];
	}

	async listSessions(limit = 200): Promise<SessionRecord[]> {
		const reply = await this.client.command("session.list", { limit });
		return Array.isArray(reply.payload?.sessions)
			? (reply.payload.sessions as SessionRecord[])
			: [];
	}

	/**
	 * Subscribe to UI-relevant hub events.
	 * Returns an unsubscribe function.
	 */
	subscribeUI(handlers: {
		onNotify?: (payload: HubUINotifyPayload) => void;
		onShowWindow?: (payload: HubUIShowWindowPayload) => void;
		onClientRegistered?: (payload: Record<string, unknown>) => void;
		onClientDisconnected?: (payload: Record<string, unknown>) => void;
		onSessionCreated?: (payload: Record<string, unknown>) => void;
		onSessionUpdated?: (payload: Record<string, unknown>) => void;
		onSessionDetached?: (payload: Record<string, unknown>) => void;
	}): () => void {
		return this.client.subscribe((event: HubEventEnvelope) => {
			switch (event.event) {
				case "ui.notify":
					handlers.onNotify?.(event.payload as unknown as HubUINotifyPayload);
					break;
				case "ui.show_window":
					handlers.onShowWindow?.(
						event.payload as unknown as HubUIShowWindowPayload,
					);
					break;
				case "hub.client.registered":
					handlers.onClientRegistered?.(event.payload ?? {});
					break;
				case "hub.client.disconnected":
					handlers.onClientDisconnected?.(event.payload ?? {});
					break;
				case "session.created":
					handlers.onSessionCreated?.(event.payload ?? {});
					break;
				case "session.updated":
					handlers.onSessionUpdated?.(event.payload ?? {});
					break;
				case "session.detached":
					handlers.onSessionDetached?.(event.payload ?? {});
					break;
			}
		});
	}
}
