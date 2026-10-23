/**
 * Test-only glue between `startTestHub` and the session core.
 *
 * The resolver takes a client *factory*, so these helpers are where the test's
 * auth choice lives: `hub-subprotocol` with the hub's real token. Production
 * would pass a `bearer-header` client instead, and neither the resolver nor
 * `SessionConnection` can tell the difference.
 */

import {
	HubClient,
	type WebSocketCtor,
	type WebSocketLike,
} from "@cline/hub-client";
import type { TestHub } from "@cline/hub-testkit";
import {
	FakeRemoteSessionGateway,
	type RemoteSession,
	resolveCloudSession,
	type SessionHandle,
} from "../cloud-resolver";
import { asRemoteSessionId } from "../ids";
import type { SessionDiagnostic } from "../reducer";

export const TEST_REMOTE_SESSION_ID = asRemoteSessionId("rs_sandbox_1");

export function testRemoteSession(
	hub: TestHub,
	overrides: Partial<RemoteSession> = {},
): RemoteSession {
	return {
		id: TEST_REMOTE_SESSION_ID,
		// The sandbox url *is* the hub url by cloud convention.
		sandboxUrl: hub.url,
		status: "running",
		expiredAt: null,
		...overrides,
	};
}

export function testGateway(
	hub: TestHub,
	overrides: Partial<RemoteSession> = {},
): FakeRemoteSessionGateway {
	return new FakeRemoteSessionGateway([testRemoteSession(hub, overrides)]);
}

/** The `session.create` payload the scripted hub expects. */
export function testCreateSessionInput(hub: TestHub): Record<string, unknown> {
	const workspaceRoot = hub.runtimeHost.workspaceRoot;
	return {
		workspaceRoot,
		cwd: workspaceRoot,
		sessionConfig: {
			providerId: "testkit",
			modelId: "testkit-model",
			cwd: workspaceRoot,
			workspaceRoot,
			systemPrompt: "testkit",
		},
		metadata: { source: "core", interactive: true },
	};
}

export interface ResolveTestSessionOptions {
	gateway?: FakeRemoteSessionGateway;
	remoteSessionId?: typeof TEST_REMOTE_SESSION_ID;
	WebSocketImpl?: WebSocketCtor;
	onDiagnostic?: (diagnostic: SessionDiagnostic) => void;
	now?: () => number;
}

export async function resolveTestHubSession(
	hub: TestHub,
	options: ResolveTestSessionOptions = {},
): Promise<SessionHandle> {
	return await resolveCloudSession({
		gateway: options.gateway ?? testGateway(hub),
		remoteSessionId: options.remoteSessionId ?? TEST_REMOTE_SESSION_ID,
		createSessionInput: testCreateSessionInput(hub),
		...(options.now ? { now: options.now } : {}),
		...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
		clientFactory: ({ url, onConnectionState }) =>
			new HubClient({
				url,
				authMode: "hub-subprotocol",
				credential: hub.authToken,
				clientType: "cline-mobile",
				displayName: "cline-mobile",
				workspaceRoot: hub.runtimeHost.workspaceRoot,
				cwd: hub.runtimeHost.workspaceRoot,
				// The resolver owns the fan-out; the factory only has to plug it in.
				onConnectionState,
				...(options.WebSocketImpl
					? { WebSocketImpl: options.WebSocketImpl }
					: {}),
			}),
	});
}

export interface DroppableTransport {
	ctor: WebSocketCtor;
	/** Closes the live socket with a server-style code so HubClient reconnects. */
	drop(): void;
	/**
	 * Makes every *new* socket fail to open, so the client stays offline while the
	 * hub keeps running. This is what makes "the run finished while we were away"
	 * deterministic instead of a race against the reconnect backoff.
	 */
	block(): void;
	unblock(): void;
	openedCount(): number;
}

/**
 * A `WebSocketImpl` whose socket can be yanked from under `HubClient`.
 *
 * `HubClient.close()` latches `closedByClient` and suppresses reconnects, so a
 * genuine drop has to happen at the socket, not through the client.
 */
export function createDroppableTransport(): DroppableTransport {
	const sockets: WebSocketLike[] = [];
	let blocked = false;
	const base = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
	if (!base) {
		throw new Error("No global WebSocket to wrap.");
	}

	/** A socket that never opens: it reports a server-style close on the next tick. */
	class UnreachableSocket implements WebSocketLike {
		readonly readyState = 3;
		private readonly listeners = new Map<
			string,
			Set<(...args: unknown[]) => void>
		>();

		constructor() {
			setTimeout(() => {
				this.dispatch("error", { message: "transport blocked" });
				this.dispatch("close", {
					code: 4003,
					reason: "transport blocked",
					wasClean: false,
				});
			}, 0);
		}

		send(): void {
			throw new Error("transport blocked");
		}

		close(): void {}

		addEventListener(
			type: string,
			listener: (...args: unknown[]) => void,
		): void {
			const entries = this.listeners.get(type) ?? new Set();
			entries.add(listener);
			this.listeners.set(type, entries);
		}

		private dispatch(type: string, event: unknown): void {
			for (const listener of this.listeners.get(type) ?? []) {
				listener(event);
			}
		}
	}

	class DroppableSocket implements WebSocketLike {
		private readonly inner: WebSocketLike;

		constructor(url: string, protocols?: string | string[], options?: unknown) {
			if (blocked) {
				this.inner = new UnreachableSocket();
				return;
			}
			const Base = base as unknown as new (
				url: string,
				protocols?: string | string[],
				options?: unknown,
			) => WebSocketLike;
			this.inner = options
				? new Base(url, protocols, options)
				: protocols
					? new Base(url, protocols)
					: new Base(url);
			sockets.push(this.inner);
		}

		get readyState(): number {
			return this.inner.readyState;
		}

		send(data: string): void {
			this.inner.send(data);
		}

		close(): void {
			this.inner.close();
		}

		addEventListener(
			type: string,
			listener: (...args: unknown[]) => void,
		): void {
			this.inner.addEventListener(type, listener);
		}
	}

	return {
		ctor: DroppableSocket as unknown as WebSocketCtor,
		drop: () => {
			const live = sockets[sockets.length - 1];
			(
				live as unknown as { close: (code?: number, reason?: string) => void }
			).close(4001, "simulated network drop");
		},
		block: () => {
			blocked = true;
		},
		unblock: () => {
			blocked = false;
		},
		openedCount: () => sockets.length,
	};
}

export async function waitFor(
	predicate: () => boolean,
	label: string,
	timeoutMs = 15_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) {
			throw new Error(`Timed out waiting for ${label}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
