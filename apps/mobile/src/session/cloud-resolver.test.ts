import {
	HubClient,
	type HubClientOptions,
	HubCommandError,
	type HubConnectionStateChange,
} from "@cline/hub-client";
import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import {
	HUB_CLIENT_ID_IN_USE_ERROR_CODE,
	SessionNotFoundError,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	ExactSessionNotFoundError,
	FakeRemoteSessionGateway,
	hubUrlForSandbox,
	type RemoteSession,
	RemoteSessionExpiredError,
	RemoteSessionNotFoundError,
	resolveCloudSession,
	SessionListUnavailableError,
} from "./cloud-resolver";
import { asHubSessionId, asRemoteSessionId } from "./ids";
import type { SessionDiagnostic } from "./reducer";

/**
 * A `HubClient` with the socket removed: the resolver only needs `connect` and
 * `command`, and stubbing at that seam keeps these tests free of any transport.
 */
class StubHubClient extends HubClient {
	readonly commands: Array<{
		command: string;
		payload?: Record<string, unknown>;
	}> = [];
	connectCount = 0;

	constructor(
		options: HubClientOptions,
		private readonly replies: Record<
			string,
			(payload?: Record<string, unknown>) => Record<string, unknown> | Error
		>,
	) {
		super(options);
	}

	override async connect(): Promise<void> {
		this.connectCount += 1;
	}

	override async command(
		command: HubCommandEnvelope["command"],
		payload?: Record<string, unknown>,
	): Promise<HubReplyEnvelope> {
		this.commands.push({ command, payload });
		const reply = this.replies[command];
		if (!reply) {
			throw new HubCommandError(command, "unsupported", `no stub: ${command}`);
		}
		const result = reply(payload);
		if (result instanceof Error) {
			throw result;
		}
		return { version: "v1", ok: true, payload: result };
	}

	closeCount = 0;

	override close(): void {
		this.closeCount += 1;
	}
}

function remoteSession(overrides: Partial<RemoteSession> = {}): RemoteSession {
	return {
		id: asRemoteSessionId("rs_1"),
		sandboxUrl: "https://sandbox-1.cline.bot/hub",
		status: "running",
		expiredAt: null,
		...overrides,
	};
}

function sessionRow(sessionId: string, updatedAt: number) {
	return { sessionId, updatedAt, createdAt: 0, status: "idle" };
}

describe("persistent workspace opening", () => {
	function setup(status: RemoteSession["status"] = "suspended") {
		const remote = remoteSession({
			status,
			sandboxType: "resumable",
			taskId: "saved-task",
			expiredAt: 1,
		});
		const order: string[] = [];
		const client = new StubHubClient(
			{ url: remote.sandboxUrl },
			{
				"session.get": () => ({ session: { sessionId: "saved-task" } }),
				"session.update_connection": () => {
					order.push("probe");
					return {};
				},
			},
		);
		const gateway = {
			listRemoteSessions: vi.fn(async () => [remote]),
			getRemoteSession: vi.fn(async () => remote),
			resumeSuspendedSession: vi.fn(async () => {
				order.push("resume");
				return { ...remote, status: "provisioning" as const };
			}),
			waitUntilReady: vi.fn(async () => {
				order.push("ready");
			}),
		};
		const clientFactory = vi.fn(() => {
			order.push("connect");
			return client;
		});
		return {
			remote,
			order,
			gateway,
			client,
			clientFactory,
			options: {
				gateway,
				remoteSessionId: remote.id,
				clientFactory,
				allowInitialCreate: false,
			},
		};
	}
	it("resumes before connecting and selects the saved canonical task despite old lease expiry", async () => {
		const f = setup();
		const handle = await resolveCloudSession(f.options);
		expect(handle.hubSessionId).toBe("saved-task");
		expect(handle.needsCreate).toBe(false);
		expect(f.order).toEqual(["resume", "ready", "connect", "probe"]);
		expect(
			f.client.commands.some(({ command }) => command === "session.create"),
		).toBe(false);
	});
	it("does not wake an already-running persistent workspace", async () => {
		const f = setup("running");
		await resolveCloudSession(f.options);
		expect(f.gateway.resumeSuspendedSession).not.toHaveBeenCalled();
	});
	it.each([
		"expired",
		"failed",
	] as const)("does not revive a terminal %s workspace just because storage is persistent", async (status) => {
		const f = setup(status);
		await expect(resolveCloudSession(f.options)).rejects.toBeInstanceOf(
			RemoteSessionExpiredError,
		);
		expect(f.clientFactory).not.toHaveBeenCalled();
		expect(f.gateway.resumeSuspendedSession).not.toHaveBeenCalled();
	});
	it("does not connect or create if resume is rejected", async () => {
		const f = setup();
		f.gateway.resumeSuspendedSession.mockRejectedValue(
			new Error("Instance limit reached"),
		);
		await expect(resolveCloudSession(f.options)).rejects.toThrow(
			"Instance limit reached",
		);
		expect(f.clientFactory).not.toHaveBeenCalled();
	});
	it("does not connect when cancelled during resume", async () => {
		const f = setup();
		const abort = new AbortController();
		f.gateway.resumeSuspendedSession.mockImplementation(async () => {
			abort.abort(new Error("Cancelled"));
			return { ...f.remote, status: "provisioning" };
		});
		await expect(
			resolveCloudSession({ ...f.options, signal: abort.signal }),
		).rejects.toThrow("Cancelled");
		expect(f.clientFactory).not.toHaveBeenCalled();
	});
});

describe("canonical Cloud task identity", () => {
	it.each([
		"recovers",
		"persists",
		"unauthorized",
		"cancelled",
	])("handles registration cleanup race: %s", async (scenario) => {
		const remote = remoteSession({ taskId: "root" });
		const { factory } = stubFactory([sessionRow("root", 1)]);
		const client = factory({ url: remote.sandboxUrl, remoteSession: remote });
		const conflict = new HubCommandError(
			"client.register",
			HUB_CLIENT_ID_IN_USE_ERROR_CODE,
			"identity still registered",
		);
		const unauthorized = new HubCommandError(
			"client.register",
			"unauthorized",
			"sign in again",
		);
		const signal = new AbortController();
		const connect = vi.spyOn(client, "connect").mockImplementation(async () => {
			if (scenario === "cancelled") signal.abort(new Error("cancelled"));
			if (scenario === "unauthorized") throw unauthorized;
			if (scenario !== "recovers" || connect.mock.calls.length === 1)
				throw conflict;
		});
		const result = resolveCloudSession({
			gateway: new FakeRemoteSessionGateway([remote]),
			remoteSessionId: remote.id,
			clientFactory: () => client,
			signal: signal.signal,
		});
		if (scenario === "recovers") {
			await expect(result).resolves.toMatchObject({ hubSessionId: "root" });
			expect(connect).toHaveBeenCalledTimes(2);
		} else {
			await expect(result).rejects.toThrow(
				scenario === "cancelled"
					? "cancelled"
					: scenario === "unauthorized"
						? "sign in again"
						: "identity still registered",
			);
			expect(connect).toHaveBeenCalledTimes(scenario === "persists" ? 3 : 1);
			expect(client.closeCount).toBe(1);
		}
	});
	const remote = remoteSession({ taskId: "tsk-root" });
	it.each([
		{ sessions: [] },
		{
			sessions: [
				{
					sessionId: "child",
					updatedAt: 99,
					metadata: { parentSessionId: "root" },
				},
			],
		},
	])("does not recreate a missing legacy root on resume", async ({
		sessions,
	}) => {
		const legacy = remoteSession();
		const { factory, created } = stubFactory(sessions);
		await expect(
			resolveCloudSession({
				gateway: new FakeRemoteSessionGateway([legacy]),
				remoteSessionId: legacy.id,
				clientFactory: factory,
				allowInitialCreate: false,
			}),
		).rejects.toBeInstanceOf(ExactSessionNotFoundError);
		expect(created).toEqual([]);
	});
	it("gets the assigned task directly even beside a newer child", async () => {
		const { factory } = stubFactory([
			sessionRow("tsk-root", 1),
			sessionRow("tsk-child", 999),
		]);
		const handle = await resolveCloudSession({
			gateway: new FakeRemoteSessionGateway([remote]),
			remoteSessionId: remote.id,
			clientFactory: factory,
		});
		expect(handle.hubSessionId).toBe("tsk-root");
		expect(
			(handle.client as StubHubClient).commands.map((row) => row.command),
		).toEqual(["session.get"]);
	});
	it("does not recreate a missing resumed task or choose another task", async () => {
		const { factory, created } = stubFactory([sessionRow("tsk-other", 999)]);
		await expect(
			resolveCloudSession({
				gateway: new FakeRemoteSessionGateway([remote]),
				remoteSessionId: remote.id,
				clientFactory: factory,
				createNewSession: true,
			}),
		).rejects.toBeInstanceOf(ExactSessionNotFoundError);
		expect(created).toEqual([]);
	});
	it("only the initial-send capability permits creating the assigned task", async () => {
		const { factory } = stubFactory([], { createdSessionId: "tsk-root" });
		const handle = await resolveCloudSession({
			gateway: new FakeRemoteSessionGateway([remote]),
			remoteSessionId: remote.id,
			clientFactory: factory,
			allowInitialCreate: true,
			createSessionInput: { sessionConfig: { modelId: "m" } },
		});
		expect(handle.needsCreate).toBe(true);
		await expect(handle.ensureSession()).resolves.toBe("tsk-root");
		expect((handle.client as StubHubClient).commands.at(-1)?.payload).toEqual({
			sessionConfig: { modelId: "m", sessionId: "tsk-root" },
		});
	});
	it("reuses an already-created initial task after process eviction", async () => {
		const { factory, created } = stubFactory([sessionRow("tsk-root", 1)]);
		const handle = await resolveCloudSession({
			gateway: new FakeRemoteSessionGateway([remote]),
			remoteSessionId: remote.id,
			clientFactory: factory,
			allowInitialCreate: true,
			createNewSession: true,
		});
		expect(await handle.ensureSession()).toBe("tsk-root");
		expect(created).toEqual([]);
	});
	it("never recreates an explicitly pinned task even with initial-create permission", async () => {
		const { factory } = stubFactory([]);
		await expect(
			resolveCloudSession({
				gateway: new FakeRemoteSessionGateway([remote]),
				remoteSessionId: remote.id,
				clientFactory: factory,
				allowInitialCreate: true,
				hubSessionId: "tsk-root",
			}),
		).rejects.toBeInstanceOf(ExactSessionNotFoundError);
	});
	it("filters nested sessions from legacy fallback", async () => {
		const legacy = remoteSession();
		const { factory } = stubFactory([
			sessionRow("root", 1),
			{ ...sessionRow("child", 999), metadata: { parentSessionId: "root" } },
		] as Array<ReturnType<typeof sessionRow>>);
		const handle = await resolveCloudSession({
			gateway: new FakeRemoteSessionGateway([legacy]),
			remoteSessionId: legacy.id,
			clientFactory: factory,
		});
		expect(handle.hubSessionId).toBe("root");
	});
	it("waits for resumed provisioning before constructing a socket", async () => {
		let ready!: () => void;
		const waiting = new Promise<void>((resolve) => {
			ready = resolve;
		});
		const gateway = new FakeRemoteSessionGateway([
			remoteSession({ status: "provisioning" }),
		]);
		const { factory } = stubFactory([sessionRow("root", 1)]);
		const resolving = resolveCloudSession({
			gateway: {
				...gateway,
				getRemoteSession: gateway.getRemoteSession.bind(gateway),
				listRemoteSessions: gateway.listRemoteSessions.bind(gateway),
				waitUntilReady: async () => waiting,
			},
			remoteSessionId: remote.id,
			clientFactory: factory,
		});
		await Promise.resolve();
		expect(factory).not.toHaveBeenCalled();
		ready();
		await resolving;
		expect(factory).toHaveBeenCalledOnce();
	});
});

function stubFactory(
	sessions: Array<{ sessionId: string; updatedAt: number }>,
	options: { createdSessionId?: string } = {},
) {
	const created: string[] = [];
	const factory = vi.fn(
		(input: { url: string; remoteSession: RemoteSession }) =>
			new StubHubClient(
				{ url: input.url },
				{
					"session.list": () => ({ sessions }),
					"session.get": (payload) => {
						const session = sessions.find(
							(row) => row.sessionId === payload?.sessionId,
						);
						return session
							? { session }
							: new SessionNotFoundError(String(payload?.sessionId));
					},
					"session.create": () => {
						const sessionId =
							options.createdSessionId ?? `ses_created_${created.length + 1}`;
						created.push(sessionId);
						return { session: { sessionId } };
					},
				},
			),
	);
	return { factory, created };
}

describe("hubUrlForSandbox", () => {
	it("swaps the scheme and otherwise connects to the sandbox url as-is", () => {
		expect(hubUrlForSandbox("https://sandbox-1.cline.bot/hub")).toBe(
			"wss://sandbox-1.cline.bot/hub",
		);
		expect(hubUrlForSandbox("http://127.0.0.1:9999/hub?x=1")).toBe(
			"ws://127.0.0.1:9999/hub?x=1",
		);
		expect(hubUrlForSandbox("wss://sandbox-1.cline.bot/hub")).toBe(
			"wss://sandbox-1.cline.bot/hub",
		);
	});

	it("rejects a sandbox url it cannot turn into a websocket url", () => {
		expect(() => hubUrlForSandbox("not-a-url")).toThrow(/sandbox url/i);
		expect(() => hubUrlForSandbox("ftp://example.com")).toThrow(/sandbox url/i);
	});
});

describe("resolveCloudSession", () => {
	it("fails with a typed error when the outer session is gone", async () => {
		const gateway = new FakeRemoteSessionGateway();
		const { factory } = stubFactory([]);
		await expect(
			resolveCloudSession({
				gateway,
				remoteSessionId: asRemoteSessionId("rs_missing"),
				clientFactory: factory,
			}),
		).rejects.toBeInstanceOf(RemoteSessionNotFoundError);
		expect(factory).not.toHaveBeenCalled();
	});

	it("preserves the unavailable workspace reason in the typed error's technical detail", async () => {
		const gateway = new FakeRemoteSessionGateway([
			remoteSession({
				status: "failed",
				statusReason: "Repository clone failed",
			}),
		]);
		const { factory } = stubFactory([]);
		const error = await resolveCloudSession({
			gateway,
			remoteSessionId: asRemoteSessionId("rs_1"),
			clientFactory: factory,
		}).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(RemoteSessionExpiredError);
		expect(error).toMatchObject({
			message: expect.stringContaining("Repository clone failed"),
		});
		expect((error as RemoteSessionExpiredError).remoteSessionId).toBe("rs_1");
		expect(factory).not.toHaveBeenCalled();
	});

	it("treats a past expiry timestamp as expired and a future one as live", async () => {
		const gateway = new FakeRemoteSessionGateway([
			remoteSession({ id: asRemoteSessionId("rs_old"), expiredAt: 500 }),
			remoteSession({ id: asRemoteSessionId("rs_new"), expiredAt: 2_000 }),
		]);
		const { factory } = stubFactory([sessionRow("ses_1", 1)]);
		const now = () => 1_000;
		await expect(
			resolveCloudSession({
				gateway,
				remoteSessionId: asRemoteSessionId("rs_old"),
				clientFactory: factory,
				now,
			}),
		).rejects.toBeInstanceOf(RemoteSessionExpiredError);
		const handle = await resolveCloudSession({
			gateway,
			remoteSessionId: asRemoteSessionId("rs_new"),
			clientFactory: factory,
			now,
		});
		expect(handle.hubSessionId).toBe("ses_1");
	});

	it("derives the hub url from the sandbox url and never chooses an auth mode", async () => {
		const gateway = new FakeRemoteSessionGateway([remoteSession()]);
		const { factory } = stubFactory([sessionRow("ses_1", 1)]);
		const handle = await resolveCloudSession({
			gateway,
			remoteSessionId: asRemoteSessionId("rs_1"),
			clientFactory: factory,
		});
		expect(factory).toHaveBeenCalledTimes(1);
		expect(factory.mock.calls[0]?.[0]).toMatchObject({
			url: "wss://sandbox-1.cline.bot/hub",
			remoteSession: gateway.get(asRemoteSessionId("rs_1")),
			onConnectionState: expect.any(Function),
		});
		// Auth is entirely the factory's business; the resolver passes no
		// credential and no auth mode of its own.
		expect(JSON.stringify(factory.mock.calls[0]?.[0])).not.toMatch(
			/authMode|credential/,
		);
		expect((handle.client as StubHubClient).connectCount).toBe(1);
	});

	it("picks the newest inner session, tie-breaking on id", async () => {
		const gateway = new FakeRemoteSessionGateway([remoteSession()]);
		const { factory } = stubFactory([
			sessionRow("ses_old", 100),
			sessionRow("ses_z", 300),
			sessionRow("ses_a", 300),
			sessionRow("ses_mid", 200),
		]);
		const handle = await resolveCloudSession({
			gateway,
			remoteSessionId: asRemoteSessionId("rs_1"),
			clientFactory: factory,
		});
		expect(handle.hubSessionId).toBe("ses_a");
		expect(handle.needsCreate).toBe(false);
		await expect(handle.ensureSession()).resolves.toBe("ses_a");
		expect(
			(handle.client as StubHubClient).commands.map((entry) => entry.command),
		).toEqual(["session.list"]);
	});

	it("honours a handoff's exact hub session instead of choosing newest", async () => {
		const gateway = new FakeRemoteSessionGateway([remoteSession()]);
		const { factory } = stubFactory([
			sessionRow("ses_handoff", 100),
			sessionRow("ses_newest", 999),
		]);
		const handle = await resolveCloudSession({
			gateway,
			remoteSessionId: asRemoteSessionId("rs_1"),
			clientFactory: factory,
			hubSessionId: "ses_handoff",
		});
		expect(handle.hubSessionId).toBe("ses_handoff");
	});

	it("refuses a missing handoff session instead of opening another one", async () => {
		const gateway = new FakeRemoteSessionGateway([remoteSession()]);
		const { factory } = stubFactory([sessionRow("ses_newest", 999)]);
		await expect(
			resolveCloudSession({
				gateway,
				remoteSessionId: asRemoteSessionId("rs_1"),
				clientFactory: factory,
				hubSessionId: "ses_missing",
			}),
		).rejects.toBeInstanceOf(ExactSessionNotFoundError);
	});

	it("falls back to createdAt when rows carry no updatedAt", async () => {
		const gateway = new FakeRemoteSessionGateway([remoteSession()]);
		const { factory } = stubFactory([
			{ sessionId: "ses_1", createdAt: 5 } as never,
			{ sessionId: "ses_2", createdAt: 9 } as never,
		]);
		const handle = await resolveCloudSession({
			gateway,
			remoteSessionId: asRemoteSessionId("rs_1"),
			clientFactory: factory,
		});
		expect(handle.hubSessionId).toBe("ses_2");
	});

	it("returns a needsCreate handle when the sandbox has no inner session", async () => {
		const gateway = new FakeRemoteSessionGateway([remoteSession()]);
		const { factory } = stubFactory([], { createdSessionId: "ses_fresh" });
		const handle = await resolveCloudSession({
			gateway,
			remoteSessionId: asRemoteSessionId("rs_1"),
			clientFactory: factory,
		});
		expect(handle.needsCreate).toBe(true);
		expect(handle.hubSessionId).toBeUndefined();
		const client = handle.client as StubHubClient;
		expect(client.commands.map((entry) => entry.command)).toEqual([
			"session.list",
		]);

		const [first, second] = await Promise.all([
			handle.ensureSession(),
			handle.ensureSession(),
		]);
		expect([first, second]).toEqual(["ses_fresh", "ses_fresh"]);
		expect(handle.hubSessionId).toBe("ses_fresh");
		expect(handle.needsCreate).toBe(false);
		// Lazy and exactly once, even for concurrent callers.
		expect(
			client.commands.filter((entry) => entry.command === "session.create"),
		).toHaveLength(1);
	});

	it("creates a new inner session when requested even if one exists", async () => {
		const gateway = new FakeRemoteSessionGateway([remoteSession()]);
		const { factory } = stubFactory([sessionRow("ses_existing", 10)], {
			createdSessionId: "ses_fresh",
		});
		const handle = await resolveCloudSession({
			gateway,
			remoteSessionId: asRemoteSessionId("rs_1"),
			clientFactory: factory,
			createNewSession: true,
		});

		expect(handle.needsCreate).toBe(true);
		expect(handle.hubSessionId).toBeUndefined();
		await expect(handle.ensureSession()).resolves.toBe("ses_fresh");
	});

	it("passes the caller's session.create input through", async () => {
		const gateway = new FakeRemoteSessionGateway([remoteSession()]);
		const { factory } = stubFactory([]);
		const handle = await resolveCloudSession({
			gateway,
			remoteSessionId: asRemoteSessionId("rs_1"),
			clientFactory: factory,
			createSessionInput: { workspaceRoot: "/sandbox" },
		});
		await handle.ensureSession();
		const create = (handle.client as StubHubClient).commands.find(
			(entry) => entry.command === "session.create",
		);
		expect(create?.payload).toEqual({ workspaceRoot: "/sandbox" });
	});

	it("fails instead of forking the chat when session.list is unusable", async () => {
		const gateway = new FakeRemoteSessionGateway([remoteSession()]);
		let client: StubHubClient | undefined;
		const factory = () => {
			client = new StubHubClient(
				{ url: "wss://sandbox-1.cline.bot/hub" },
				{
					"session.list": () => ({ sessions: "nope" }),
					"session.create": () => ({ session: { sessionId: "ses_new" } }),
				},
			);
			return client;
		};
		const error = await resolveCloudSession({
			gateway,
			remoteSessionId: asRemoteSessionId("rs_1"),
			clientFactory: factory,
		}).catch((caught: unknown) => caught);
		// A `needsCreate` handle here would silently start a second transcript in a
		// sandbox that already has one.
		expect(error).toBeInstanceOf(SessionListUnavailableError);
		expect((error as SessionListUnavailableError).remoteSessionId).toBe("rs_1");
		expect(client?.commands.map((entry) => entry.command)).toEqual([
			"session.list",
		]);
		expect(client?.closeCount).toBe(1);
	});

	it("fails when every listed row is unusable", async () => {
		const gateway = new FakeRemoteSessionGateway([remoteSession()]);
		const factory = () =>
			new StubHubClient(
				{ url: "wss://sandbox-1.cline.bot/hub" },
				{
					"session.list": () => ({ sessions: [{ nope: true }] }),
					"session.create": () => ({ session: { sessionId: "ses_new" } }),
				},
			);
		await expect(
			resolveCloudSession({
				gateway,
				remoteSessionId: asRemoteSessionId("rs_1"),
				clientFactory: factory,
			}),
		).rejects.toBeInstanceOf(SessionListUnavailableError);
	});

	it("still resolves when one row is unusable and another is not", async () => {
		const gateway = new FakeRemoteSessionGateway([remoteSession()]);
		const diagnostics: SessionDiagnostic[] = [];
		const factory = () =>
			new StubHubClient(
				{ url: "wss://sandbox-1.cline.bot/hub" },
				{
					"session.list": () => ({
						sessions: [{ nope: true }, sessionRow("ses_1", 1)],
					}),
				},
			);
		const handle = await resolveCloudSession({
			gateway,
			remoteSessionId: asRemoteSessionId("rs_1"),
			clientFactory: factory,
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		});
		expect(handle.hubSessionId).toBe("ses_1");
		expect(diagnostics).toEqual([
			expect.objectContaining({ level: "warn", command: "session.list" }),
		]);
	});

	it("fans the client's connection-state changes out to the handle", async () => {
		const gateway = new FakeRemoteSessionGateway([remoteSession()]);
		let sink: ((change: HubConnectionStateChange) => void) | undefined;
		const handle = await resolveCloudSession({
			gateway,
			remoteSessionId: asRemoteSessionId("rs_1"),
			clientFactory: (input) => {
				sink = input.onConnectionState;
				return new StubHubClient(
					{ url: input.url, onConnectionState: input.onConnectionState },
					{ "session.list": () => ({ sessions: [sessionRow("ses_1", 1)] }) },
				);
			},
		});
		const seen: HubConnectionStateChange[] = [];
		const unsubscribe = handle.onConnectionState((change) => seen.push(change));
		sink?.({ state: "connected", connectionEpoch: 4 });
		unsubscribe();
		sink?.({ state: "closed", connectionEpoch: 4 });
		expect(seen).toEqual([{ state: "connected", connectionEpoch: 4 }]);
	});

	it("surfaces a session.create failure to the caller", async () => {
		const gateway = new FakeRemoteSessionGateway([remoteSession()]);
		const factory = () =>
			new StubHubClient(
				{ url: "wss://sandbox-1.cline.bot/hub" },
				{
					"session.list": () => ({ sessions: [] }),
					"session.create": () =>
						new HubCommandError("session.create", "boom", "nope"),
				},
			);
		const handle = await resolveCloudSession({
			gateway,
			remoteSessionId: asRemoteSessionId("rs_1"),
			clientFactory: factory,
		});
		await expect(handle.ensureSession()).rejects.toThrow(/nope/);
		// A failed create must not latch: the next attempt tries again.
		await expect(handle.ensureSession()).rejects.toThrow(/nope/);
	});
});

describe("FakeRemoteSessionGateway", () => {
	it("lists what it was seeded with and reflects mutations", async () => {
		const gateway = new FakeRemoteSessionGateway([remoteSession()]);
		expect(
			(await gateway.listRemoteSessions()).map((entry) => entry.id),
		).toEqual(["rs_1"]);
		gateway.set(remoteSession({ id: asRemoteSessionId("rs_2") }));
		expect(await gateway.listRemoteSessions()).toHaveLength(2);
		gateway.remove(asRemoteSessionId("rs_1"));
		expect(
			await gateway.getRemoteSession(asRemoteSessionId("rs_1")),
		).toBeUndefined();
	});

	it("hands out hub session ids that keep their brand", () => {
		expect(asHubSessionId("ses_1")).toBe("ses_1");
	});
});
