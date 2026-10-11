import { HubUIClient } from "@cline/core";
import type { HubUINotifyPayload } from "@cline/shared";

import type { ConnectorThreadState } from "./thread-bindings";
import {
	resolveNotifyTargets,
	type UiNotifySource,
} from "./ui-notify-delivery";

/**
 * Subscribes a connector to the hub's `ui.notify` broadcast and posts each notification into
 * the conversation bound to the workspace it came from.
 *
 * This is the half that was missing. The hub has broadcast `ui.notify` for a while, but the
 * only subscriber has been the menubar app -- so `--zen`, which announces completion only that
 * way, is silent for anyone without it, and a Kanban card that finishes has nowhere to say so.
 *
 * Everything here is best-effort by contract. A connector that dies because a notification
 * could not be posted is worse than one that misses the notification: the first takes the
 * conversation down with it.
 */

/**
 * The slice of `HubUIClient` this module uses. It is assignable FROM the real client, so the
 * compiler checks the shape instead of a cast hiding a mismatch -- the first version of this
 * file invented a `subscribe` method and only the running connector found out.
 */
export interface UiNotifyClient {
	connect(): Promise<void>;
	subscribeUI(handlers: {
		onNotify?: (payload: HubUINotifyPayload) => void;
	}): () => void;
	close(): void;
	dispose(): Promise<void>;
}

export interface StartUiNotifyDeliveryInput<
	TState extends ConnectorThreadState,
> {
	/** Overridable for tests; defaults to a real `HubUIClient`. */
	createClient?: () => UiNotifyClient;
	address?: string;
	authToken?: string;
	displayName?: string;
	/** Read fresh on each event: bindings change while the connector runs. */
	readBindings: () => Record<string, { state?: TState }>;
	deliver: (
		threadKey: string,
		text: string,
		options: NotifyDeliveryOptions,
	) => Promise<void>;
	onError?: (error: unknown) => void;
}

export interface NotifyDeliveryOptions {
	/** The thing the notification is about, when it names one. The key for superseding. */
	itemId?: string;
	/** Repository the notification came from, for an adapter that can answer back into it. */
	workspacePath?: string;
	/** Update the previous notification about `itemId` rather than adding another. */
	supersedesPrevious: boolean;
	/** The thing is waiting on the person now, so choices can be offered for it. */
	awaitingAnswer: boolean;
}

export interface UiNotifySubscription {
	/** Resolves once every delivery triggered so far has settled. For tests and shutdown. */
	flush(): Promise<void>;
	stop(): Promise<void>;
}

function readNotification(payload: unknown):
	| {
			text: string;
			source?: UiNotifySource;
			supersedesPrevious: boolean;
			awaitingAnswer: boolean;
	  }
	| undefined {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return undefined;
	}
	const record = payload as Record<string, unknown>;
	const title = typeof record.title === "string" ? record.title.trim() : "";
	const body = typeof record.body === "string" ? record.body.trim() : "";
	if (!title && !body) {
		return undefined;
	}
	const rawSource = record.source;
	const source =
		rawSource && typeof rawSource === "object" && !Array.isArray(rawSource)
			? (rawSource as UiNotifySource)
			: undefined;
	return {
		text: [title, body].filter(Boolean).join("\n\n"),
		source,
		supersedesPrevious: record.supersedesPrevious === true,
		awaitingAnswer: record.awaitingAnswer === true,
	};
}

export async function startUiNotifyDelivery<
	TState extends ConnectorThreadState,
>(input: StartUiNotifyDeliveryInput<TState>): Promise<UiNotifySubscription> {
	const client: UiNotifyClient =
		input.createClient?.() ??
		new HubUIClient({
			address: input.address ?? "",
			authToken: input.authToken,
			clientType: "cli",
			displayName: input.displayName ?? "connector notifications",
		});

	await client.connect();

	// Deliveries are tracked so shutdown (and tests) can wait for them, without making the
	// hub's event handler itself async -- the hub should never be blocked by a slow chat API.
	const inFlight = new Set<Promise<void>>();
	const track = (work: Promise<void>): void => {
		const tracked = work.finally(() => {
			inFlight.delete(tracked);
		});
		inFlight.add(tracked);
	};

	const unsubscribe = client.subscribeUI({
		onNotify: (payload) => {
			try {
				const notification = readNotification(payload);
				if (!notification) {
					return;
				}
				const targets = resolveNotifyTargets(
					input.readBindings(),
					notification.source,
				);
				for (const threadKey of targets) {
					track(
						input
							.deliver(threadKey, notification.text, {
								itemId: notification.source?.itemId,
								workspacePath: notification.source?.workspacePath,
								supersedesPrevious: notification.supersedesPrevious,
								awaitingAnswer: notification.awaitingAnswer,
							})
							.catch((error) => {
								input.onError?.(error);
							}),
					);
				}
			} catch (error) {
				input.onError?.(error);
			}
		},
	});

	const flush = async (): Promise<void> => {
		while (inFlight.size > 0) {
			await Promise.allSettled([...inFlight]);
		}
	};

	return {
		flush,
		async stop(): Promise<void> {
			try {
				await flush();
			} finally {
				try {
					unsubscribe();
					client.close();
					await client.dispose();
				} catch (error) {
					input.onError?.(error);
				}
			}
		},
	};
}
