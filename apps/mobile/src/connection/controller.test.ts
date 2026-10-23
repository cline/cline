/**
 * Unit cover for the controller's bootstrap/retry lifecycle, driven through the
 * `createHandle` seam so no hub or socket is involved.
 *
 * The integration suite proves a real turn end to end; these are the races a
 * Retry button can create that a happy-path turn never reaches.
 */

import {
	HubClient,
	type HubClientOptions,
	HubCommandError,
	type HubConnectionStateListener,
} from "@cline/hub-client";
import type {
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
	PendingApprovalInfo,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import type { SessionHandle } from "../session";
import { asHubSessionId, asRemoteSessionId } from "../session/ids";
import { SessionConnectionController } from "./controller";
import type { ConnectionDescriptor } from "./endpoints";

type CommandHandler = (
	payload?: Record<string, unknown>,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

class FakeHubClient extends HubClient {
	readonly handlers = new Map<string, CommandHandler>();
	closed = false;

	constructor(options: Partial<HubClientOptions> = {}) {
		super({ url: "ws://127.0.0.1:1/hub", ...options });
		this.handlers.set("session.attach", () => ({
			session: { sessionId: "ses_1", status: "idle" },
		}));
		this.handlers.set("session.get", () => ({
			session: { sessionId: "ses_1", status: "idle" },
		}));
		this.handlers.set("session.messages", () => ({
			sessionId: "ses_1",
			messages: [],
		}));
	}

	override async connect(): Promise<void> {}
	override isConnected(): boolean {
		return !this.closed;
	}
	override getConnectionEpoch(): number {
		return 1;
	}
	override hasCapability(): boolean {
		return false;
	}
	override subscribe(): () => void {
		return () => {};
	}
	override async listPendingApprovals(): Promise<PendingApprovalInfo[]> {
		return [];
	}
	override close(): void {
		this.closed = true;
	}
	override async command(
		command: HubCommandEnvelope["command"],
		payload?: Record<string, unknown>,
	): Promise<HubReplyEnvelope> {
		const handler = this.handlers.get(command);
		if (!handler) {
			throw new HubCommandError(
				command,
				"unsupported",
				`no handler: ${command}`,
			);
		}
		return { version: "v1", ok: true, payload: await handler(payload) };
	}

	emit(_envelope: HubEventEnvelope): void {}

	observe(_listener: HubConnectionStateListener): () => void {
		return () => {};
	}
}

function handleFor(client: FakeHubClient): SessionHandle {
	const hubSessionId = asHubSessionId("ses_1");
	return {
		client,
		remoteSession: {
			id: asRemoteSessionId("rs_1"),
			sandboxUrl: "wss://sandbox-1.cline.bot/hub",
			status: "running",
			expiredAt: null,
		},
		get hubSessionId() {
			return hubSessionId;
		},
		get needsCreate() {
			return false;
		},
		onConnectionState(listener) {
			return client.observe(listener);
		},
		async ensureSession() {
			return hubSessionId;
		},
	};
}

const DESCRIPTOR: ConnectionDescriptor = {
	mode: "local",
	url: "ws://127.0.0.1:1/hub",
};

const controllers: SessionConnectionController[] = [];

function makeController(
	createHandle: () => Promise<SessionHandle>,
): SessionConnectionController {
	const controller = new SessionConnectionController(DESCRIPTOR, {
		createHandle,
	});
	controllers.push(controller);
	return controller;
}

/** Lets pending microtasks drain without a timer. */
async function settle(): Promise<void> {
	for (let round = 0; round < 30; round += 1) {
		await Promise.resolve();
	}
}

describe("bootstrap serialisation", () => {
	it("propagates failed queue mutations to their inline recovery controls", async () => {
		const client = new FakeHubClient();
		client.handlers.set("session.remove_pending_prompt", () => {
			throw new Error("Remove refused");
		});
		client.handlers.set("session.update_pending_prompt", () => {
			throw new Error("Edit refused");
		});
		const controller = makeController(async () => handleFor(client));
		await controller.start();
		await expect(controller.removePendingPrompt("prompt-1")).rejects.toThrow(
			"Remove refused",
		);
		await expect(
			controller.updatePendingPrompt("prompt-1", { prompt: "Edited" }),
		).rejects.toThrow("Edit refused");
		controller.dispose();
	});
	it("a Retry double-tap during bootstrap builds exactly one client", async () => {
		const gate = deferred<void>();
		const built: FakeHubClient[] = [];
		const controller = makeController(async () => {
			await gate.promise;
			const client = new FakeHubClient();
			built.push(client);
			return handleFor(client);
		});

		const started = controller.start();
		started.catch(() => {});
		await settle();

		// Two impatient taps while the handle is still being built.
		const first = controller.reconnect();
		const second = controller.reconnect();
		await settle();

		gate.resolve();
		await started;
		await first;
		await second;
		await settle();

		// One descriptor, one client, one socket — and no orphan left connected.
		expect(built).toHaveLength(1);
		expect(built[0]?.closed).toBe(false);
		controller.dispose();
		expect(built[0]?.closed).toBe(true);
	});

	it("does not reject when a Retry fails, and reports it in status", async () => {
		let attempts = 0;
		const controller = makeController(async () => {
			attempts += 1;
			throw new Error(`handle build failed (${attempts})`);
		});

		// The initial connect fails; `start` still rejects for callers that await it.
		await expect(controller.start()).rejects.toThrow("handle build failed");
		expect(controller.getSnapshot().status.phase).toBe("error");

		// `reconnect` is wired straight to a Button press that discards the promise,
		// so it must never reject: on device an escaped rejection is a redbox.
		await expect(controller.reconnect()).resolves.toBeUndefined();
		expect(attempts).toBe(2);
		expect(controller.getSnapshot().status.phase).toBe("error");
		expect(controller.getSnapshot().status.error?.message).toContain(
			"handle build failed (2)",
		);
	});

	it("returns to ready when a Retry recovers from an attach failure", async () => {
		let attaches = 0;
		const client = new FakeHubClient();
		client.handlers.set("session.attach", () => {
			attaches += 1;
			if (attaches === 1) {
				throw new HubCommandError(
					"session.attach",
					"not_authorized",
					"not a participant",
				);
			}
			return { session: { sessionId: "ses_1", status: "idle" } };
		});
		const controller = makeController(async () => handleFor(client));

		await expect(controller.start()).rejects.toThrow(/Could not attach/);
		expect(controller.getSnapshot().status.phase).toBe("error");

		// The resync succeeds, so the error screen must go away rather than stranding
		// the user on it with a working session behind it.
		await controller.reconnect();
		expect(attaches).toBe(2);
		expect(controller.getSnapshot().status.phase).toBe("ready");
		expect(controller.getSnapshot().view.connectionStatus).toBe("live");
		controller.dispose();
	});

	it("keeps an exact resume in error when Retry still cannot attach", async () => {
		const client = new FakeHubClient();
		client.handlers.set("session.attach", () => {
			throw new HubCommandError(
				"session.attach",
				"session_not_found",
				"Unknown session: ses_1",
			);
		});
		const controller = makeController(async () => handleFor(client));

		await expect(controller.start()).rejects.toThrow(/Could not attach/);
		await expect(controller.reconnect()).resolves.toBeUndefined();
		expect(controller.getSnapshot().status.phase).toBe("error");
		expect(controller.getSnapshot().status.error?.name).toBe(
			"SessionAttachError",
		);
		controller.dispose();
	});

	it("rebuilds a closed Cloud handle on explicit retry so the resolver can resume it", async () => {
		const first = new FakeHubClient();
		const second = new FakeHubClient();
		const listeners = new Set<HubConnectionStateListener>();
		first.observe = (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		};
		let builds = 0;
		const controller = new SessionConnectionController(
			{
				mode: "cloud",
				remoteSessionId: "rs_1",
				url: "https://core-api.test/session/rs_1",
			},
			{
				createHandle: async () => handleFor(builds++ === 0 ? first : second),
			},
		);
		try {
			await controller.start();
			for (const listener of listeners)
				listener({ state: "closed", connectionEpoch: 1 });
			expect(controller.getSnapshot().view.connectionStatus).toBe("closed");
			await Promise.all([controller.reconnect(), controller.reconnect()]);
			expect(builds).toBe(2);
			expect(first.closed).toBe(true);
			expect(second.closed).toBe(false);
			expect(controller.getSnapshot().status.phase).toBe("ready");
			expect(controller.getSnapshot().view.connectionStatus).toBe("live");
		} finally {
			controller.dispose();
		}
	});

	it("is a no-op after dispose", async () => {
		const built: FakeHubClient[] = [];
		const controller = makeController(async () => {
			const client = new FakeHubClient();
			built.push(client);
			return handleFor(client);
		});
		await controller.start();
		controller.dispose();
		await expect(controller.reconnect()).resolves.toBeUndefined();
		expect(built).toHaveLength(1);
	});
});
