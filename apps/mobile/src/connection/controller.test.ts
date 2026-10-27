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
import { describe, expect, it, vi } from "vitest";
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

// The inner Hub ID is a conversation identity, not the prescribed git branch.
// Desktop-created workspaces may have a distinct task ID, or no task ID at all.
describe("resolved Cloud task branch", () => {
	it.each([
		{
			taskId: "task-ABC12345",
			remoteId: "workspace-87654321",
			expected: "cline/abc12345",
		},
		{
			taskId: undefined,
			remoteId: "workspace-87654321",
			expected: "cline/87654321",
		},
	])("uses resolved workspace context: $expected", async ({
		taskId,
		remoteId,
		expected,
	}) => {
		const handle = handleFor(new FakeHubClient());
		handle.remoteSession.taskId = taskId;
		handle.remoteSession.id = asRemoteSessionId(remoteId);
		const controller = new SessionConnectionController(
			{
				mode: "cloud",
				url: "https://workspace.test",
				remoteSessionId: "stale-workspace-00000000",
				hubSessionId: "ses_1",
				branch: "main",
			},
			{ createHandle: async () => handle },
		);
		try {
			expect(controller.getSnapshot().taskBranch).toBeUndefined();
			await controller.start();
			expect(controller.getSnapshot().sessionId).toBe("ses_1");
			expect(controller.getSnapshot().taskBranch).toBe(expected);
		} finally {
			controller.dispose();
		}
	});
	it("does not prescribe a Cloud task branch for computer sessions", async () => {
		const controller = new SessionConnectionController(DESCRIPTOR, {
			createHandle: async () => handleFor(new FakeHubClient()),
		});
		try {
			await controller.start();
			expect(controller.getSnapshot().taskBranch).toBeUndefined();
		} finally {
			controller.dispose();
		}
	});
});

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
	it.each([
		"reject",
		"malformed",
	])("requires initial Cloud history and keeps retry visible for %s replies", async (failure) => {
		const client = new FakeHubClient();
		const commands = vi.spyOn(client, "command");
		client.handlers.set("session.messages", () => {
			if (failure === "reject")
				throw new Error("history temporarily unavailable");
			return { messages: null };
		});
		const controller = new SessionConnectionController(
			{ ...DESCRIPTOR, mode: "cloud", hubSessionId: "ses_1" },
			{ createHandle: async () => handleFor(client) },
		);
		await expect(controller.start()).rejects.toMatchObject({
			name: "SessionHistoryUnavailableError",
		});
		expect(controller.getSnapshot().status.phase).toBe("error");
		await controller.reconnect();
		expect(controller.getSnapshot().status.phase).toBe("error");
		client.handlers.set("session.messages", () => ({
			messages: [{ role: "user", content: "Existing conversation" }],
		}));
		await controller.reconnect();
		expect(controller.getSnapshot().status.phase).toBe("ready");
		expect(controller.getSnapshot().view.messages[0]?.blocks).toEqual([
			{ kind: "text", text: "Existing conversation" },
		]);
		expect(
			commands.mock.calls.filter(
				([command]) => command === "session.send_input",
			),
		).toHaveLength(0);
		controller.dispose();
	});

	it("propagates a failed Stop so the screen can offer an explicit retry", async () => {
		const client = new FakeHubClient();
		client.handlers.set("run.abort", () => {
			throw new Error("Stop refused");
		});
		const controller = makeController(async () => handleFor(client));
		await controller.start();
		await expect(controller.abort()).rejects.toThrow("Stop refused");
		client.handlers.set("run.abort", () => ({ applied: true }));
		await expect(controller.abort()).resolves.toBeUndefined();
		controller.dispose();
	});
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

describe("Cloud stale-transport recovery", () => {
	it("hydrates missed history on foreground without rebuilding or sending", async () => {
		const client = new FakeHubClient();
		const createHandle = vi.fn(async () => handleFor(client));
		const controller = new SessionConnectionController(
			{ mode: "cloud", url: "https://workspace.test" },
			{ createHandle },
		);
		try {
			await controller.start();
			client.handlers.set("session.messages", () => ({
				messages: [{ role: "assistant", content: "From the other device" }],
			}));
			const send = vi.fn(() => ({}));
			client.handlers.set("session.send_input", send);
			await controller.recoverFromIdle();
			expect(createHandle).toHaveBeenCalledTimes(1);
			expect(send).not.toHaveBeenCalled();
			expect(JSON.stringify(controller.getSnapshot().view.messages)).toContain(
				"From the other device",
			);
		} finally {
			controller.dispose();
		}
	});

	it("healthy periodic probes only read the exact session", async () => {
		const client = new FakeHubClient();
		const createHandle = vi.fn(async () => handleFor(client));
		const controller = new SessionConnectionController(
			{ mode: "cloud", url: "https://workspace.test" },
			{ createHandle },
		);
		try {
			await controller.start();
			const get = vi.fn(() => ({
				session: { sessionId: "ses_1", status: "idle" },
			}));
			const messages = vi.fn(() => ({ messages: [] }));
			client.handlers.set("session.get", get);
			client.handlers.set("session.messages", messages);
			await controller.checkHealth();
			expect(get).toHaveBeenCalledExactlyOnceWith({ sessionId: "ses_1" });
			expect(messages).not.toHaveBeenCalled();
			expect(createHandle).toHaveBeenCalledTimes(1);
		} finally {
			controller.dispose();
		}
	});

	it("retires a half-open socket once and pins resolved IDs before rebuilding", async () => {
		vi.useFakeTimers();
		const old = new FakeHubClient();
		old.handlers.set("session.messages", () => ({
			messages: [{ role: "assistant", content: "Last good history" }],
		}));
		const fresh = new FakeHubClient();
		fresh.handlers.set("session.messages", () => ({
			messages: [{ role: "assistant", content: "Remote update" }],
		}));
		const oldCommands = vi.spyOn(old, "command");
		const freshCommands = vi.spyOn(fresh, "command");
		const gate = deferred<SessionHandle>();
		const createHandle = vi
			.fn<(descriptor: ConnectionDescriptor) => Promise<SessionHandle>>()
			.mockResolvedValueOnce(handleFor(old))
			.mockImplementationOnce(() => gate.promise);
		const controller = new SessionConnectionController(
			{
				mode: "cloud",
				url: "https://workspace.test",
				allowInitialCreate: true,
			},
			{ createHandle },
		);
		try {
			await controller.start();
			old.handlers.set("session.get", () => new Promise(() => {}));
			const pending = controller.checkHealth();
			expect(controller.checkHealth()).toBe(pending);
			expect(controller.recoverFromIdle()).toBe(pending);
			await vi.advanceTimersByTimeAsync(5_001);
			expect(old.closed).toBe(true);
			expect(createHandle).toHaveBeenCalledTimes(2);
			expect(createHandle.mock.calls[1]?.[0]).toMatchObject({
				remoteSessionId: "rs_1",
				hubSessionId: "ses_1",
				allowInitialCreate: false,
			});
			expect(JSON.stringify(controller.getSnapshot().view.messages)).toContain(
				"Last good history",
			);
			// A new user action waits for recovery; recovery itself never replays input.
			fresh.handlers.set("session.send_input", () => ({}));
			const sending = controller.sendInput("New explicit input");
			await settle();
			expect(
				freshCommands.mock.calls.some(
					([name]) => name === "session.send_input",
				),
			).toBe(false);
			gate.resolve(handleFor(fresh));
			await pending;
			await sending;
			expect(
				oldCommands.mock.calls.filter(
					([name]) => name === "session.send_input",
				),
			).toHaveLength(0);
			expect(
				freshCommands.mock.calls.filter(
					([name]) => name === "session.send_input",
				),
			).toHaveLength(1);
			expect(
				[...oldCommands.mock.calls, ...freshCommands.mock.calls].some(
					([name]) => name === "session.create",
				),
			).toBe(false);
			expect(JSON.stringify(controller.getSnapshot().view.messages)).toContain(
				"Remote update",
			);
			expect(controller.getSnapshot().status.phase).toBe("ready");
		} finally {
			controller.dispose();
			vi.useRealTimers();
		}
	});

	it("rebuilds after failed transcript hydration rather than accepting stale history", async () => {
		const old = new FakeHubClient();
		const fresh = new FakeHubClient();
		const createHandle = vi
			.fn()
			.mockResolvedValueOnce(handleFor(old))
			.mockResolvedValueOnce(handleFor(fresh));
		const controller = new SessionConnectionController(
			{ mode: "cloud", url: "https://workspace.test" },
			{ createHandle },
		);
		try {
			await controller.start();
			old.handlers.set("session.messages", () => {
				throw new Error("lost proxy");
			});
			await controller.recoverFromIdle();
			expect(old.closed).toBe(true);
			expect(createHandle).toHaveBeenCalledTimes(2);
		} finally {
			controller.dispose();
		}
	});
});

describe("Cloud recovery failure boundaries", () => {
	it.each([
		{},
		{ session: { sessionId: "another-session" } },
	])("rejects an invalid or wrong-session health response", async (payload) => {
		const old = new FakeHubClient();
		const fresh = new FakeHubClient();
		const createHandle = vi
			.fn()
			.mockResolvedValueOnce(handleFor(old))
			.mockResolvedValueOnce(handleFor(fresh));
		const controller = new SessionConnectionController(
			{ mode: "cloud", url: "https://workspace.test" },
			{ createHandle },
		);
		try {
			await controller.start();
			old.handlers.set("session.get", () => payload);
			await controller.checkHealth();
			expect(old.closed).toBe(true);
			expect(createHandle).toHaveBeenCalledTimes(2);
		} finally {
			controller.dispose();
		}
	});

	it.each([
		"reconnect",
		"checkHealth",
		"recoverFromIdle",
	] as const)("retains the last good transcript after failed replacement and retries via %s", async (retry) => {
		const old = new FakeHubClient();
		old.handlers.set("session.messages", () => ({
			messages: [{ role: "assistant", content: "Preserve this history" }],
		}));
		const broken = new FakeHubClient();
		broken.handlers.set("session.messages", () => {
			throw new Error("history unavailable");
		});
		const fresh = new FakeHubClient();
		fresh.handlers.set("session.messages", () => ({
			messages: [{ role: "assistant", content: "Recovered history" }],
		}));
		const createHandle = vi
			.fn()
			.mockResolvedValueOnce(handleFor(old))
			.mockResolvedValueOnce(handleFor(broken))
			.mockResolvedValueOnce(handleFor(fresh));
		const controller = new SessionConnectionController(
			{ mode: "cloud", url: "https://workspace.test" },
			{ createHandle },
		);
		try {
			await controller.start();
			old.handlers.set("session.get", () => {
				throw new Error("stale socket");
			});
			await controller.checkHealth();
			expect(controller.getSnapshot().status.phase).toBe("error");
			expect(JSON.stringify(controller.getSnapshot().view.messages)).toContain(
				"Preserve this history",
			);
			expect(broken.closed).toBe(true);
			await controller[retry]();
			expect(controller.getSnapshot().status.phase).toBe("ready");
			expect(JSON.stringify(controller.getSnapshot().view.messages)).toContain(
				"Recovered history",
			);
		} finally {
			controller.dispose();
		}
	});

	it("does not rebuild after disposal during a probe", async () => {
		const old = new FakeHubClient();
		const createHandle = vi.fn(async () => handleFor(old));
		const controller = new SessionConnectionController(
			{ mode: "cloud", url: "https://workspace.test" },
			{ createHandle },
		);
		const gate = deferred<Record<string, unknown>>();
		await controller.start();
		old.handlers.set("session.get", () => gate.promise);
		const recovery = controller.checkHealth();
		await settle();
		controller.dispose();
		gate.reject(new Error("late failure"));
		await recovery;
		expect(createHandle).toHaveBeenCalledTimes(1);
	});
});
