import type { HubEventEnvelope, PluginUiStateEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionSource } from "../../types/common";
import type { HubTransportContext } from "../server/handlers/context";
import { projectSessionEvent } from "../server/handlers/session-event-projector";
import type { HubRuntimeHost } from "./hub-runtime-host";

const commandMock = vi.hoisted(() => vi.fn());
const subscribeMock = vi.hoisted(() => vi.fn());
const onRegisteredMock = vi.hoisted(() => vi.fn());
const closeMock = vi.hoisted(() => vi.fn());
const disposeMock = vi.hoisted(() => vi.fn());
const getClientIdMock = vi.hoisted(() => vi.fn(() => "client-1"));
const restartLocalHubIfIdleAfterStartupTimeoutMock = vi.hoisted(() => vi.fn());

vi.mock("../client", () => ({
	NodeHubClient: class {
		private readonly url: string;

		constructor(options: { url: string }) {
			this.url = options.url;
		}

		command = commandMock;
		subscribe = subscribeMock;
		onRegistered = onRegisteredMock;
		close = closeMock;
		dispose = disposeMock;
		getClientId = getClientIdMock;
		getUrl = () => this.url;
	},
	isHubCommandTimeoutError: (
		error: unknown,
		command?: string,
	): error is Error & { command?: string; code?: string } =>
		!!error &&
		typeof error === "object" &&
		(error as { code?: unknown }).code === "hub_command_timeout" &&
		(command === undefined ||
			(error as { command?: unknown }).command === command),
	restartLocalHubIfIdleAfterStartupTimeout:
		restartLocalHubIfIdleAfterStartupTimeoutMock,
}));

function createConfig() {
	return {
		providerId: "cline",
		modelId: "anthropic/claude-haiku-4.5",
		cwd: "/tmp/project",
		workspaceRoot: "/tmp/project",
		systemPrompt: "system",
		mode: "act" as const,
		checkpoint: { enabled: true },
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
	};
}

describe("HubRuntimeHost plugin UI", () => {
	const SLOT = "composer.suggestions";
	const sessionId = "sess-ui";
	const attach = {
		sessionId,
		slot: SLOT,
		action: { verb: "attach", surface: "desktop" },
	} as const;
	const detach = { sessionId, slot: SLOT, action: { verb: "detach" } } as const;
	const ok = { ok: true, payload: { outcome: "ok" } };
	const withdrawable = { beforeDispatch: expect.any(Function) };
	const envelope: PluginUiStateEnvelope = {
		sessionId,
		slot: SLOT,
		plugin: "composer-suggestions-demo",
		epoch: 7,
		seq: 2,
		state: {
			status: "ready",
			title: "Demo",
			revision: "r1",
			items: [
				{
					id: "verify",
					label: "Verify",
					tone: "check",
					prompt: "Run the whole test suite",
					sendable: true,
				},
			],
			canRefresh: true,
		},
	};
	const unsupported = Object.assign(new Error("Unsupported hub command"), {
		code: "unsupported_command",
	});

	afterEach(() => {
		commandMock.mockReset();
		subscribeMock.mockReset();
		onRegisteredMock.mockReset();
	});

	async function createHost() {
		subscribeMock.mockReturnValue(() => {});
		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		const registered = () => {
			for (const [listener] of onRegisteredMock.mock.calls) listener();
		};
		return { host, registered };
	}

	function invokeCalls() {
		return commandMock.mock.calls.filter(
			([command]) => command === "plugins.ui.invoke",
		);
	}

	/**
	 * Holds the next command as NodeHubClient holds one whose connection
	 * dropped. `recover()` sends it again on the recovered connection, checking
	 * its `beforeDispatch` first as the client does, and says whether it went out.
	 */
	function holdNextCommandUntilRecovery(): () => Promise<"sent" | "withdrawn"> {
		let recover!: () => void;
		const recovered = new Promise<void>((resolve) => {
			recover = resolve;
		});
		let retry: Promise<unknown> = Promise.resolve();
		commandMock.mockImplementationOnce((...args: unknown[]) => {
			const options = args[3] as { beforeDispatch?(): void } | undefined;
			retry = recovered.then(() => {
				options?.beforeDispatch?.();
				return ok;
			});
			return retry;
		});
		return () => {
			recover();
			return retry.then(
				() => "sent" as const,
				() => "withdrawn" as const,
			);
		};
	}

	it("maps the projected plugins.ui.state event to plugin_ui_state for its session only", async () => {
		const { host } = await createHost();
		let onEvent: ((event: HubEventEnvelope) => void) | undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock.mockResolvedValue({ ok: true, payload: { states: [] } });
		await host.pluginUi.get({ sessionId });
		const events: unknown[] = [];
		host.subscribe((event) => events.push(event));
		const ctx = {
			buildEvent: (
				event: HubEventEnvelope["event"],
				payload?: Record<string, unknown>,
				eventSessionId?: string,
			) => ({ version: "v1", event, payload, sessionId: eventSessionId }),
			publish: vi.fn(),
			publishEphemeral: (event: HubEventEnvelope) => {
				onEvent?.(JSON.parse(JSON.stringify(event)));
			},
		} as unknown as HubTransportContext;

		await projectSessionEvent(ctx, {
			type: "plugin_ui_state",
			payload: envelope,
		});
		onEvent?.({
			version: "v1",
			event: "plugins.ui.state",
			sessionId,
			payload: { ...envelope, sessionId: "another-session" },
		});

		expect(ctx.publish).not.toHaveBeenCalled();
		expect(events).toEqual([{ type: "plugin_ui_state", payload: envelope }]);
		await host.dispose();
	});

	it("subscribes to the session before every plugin UI command", async () => {
		const { host } = await createHost();
		commandMock.mockResolvedValue({
			ok: true,
			payload: { outcome: "ok", epoch: 7, state: envelope },
		});

		await expect(host.pluginUi.invoke(attach)).resolves.toEqual({
			outcome: "ok",
			epoch: 7,
			state: envelope,
		});

		expect(subscribeMock).toHaveBeenCalledWith(expect.any(Function), {
			sessionId,
		});
		expect(subscribeMock.mock.invocationCallOrder[0]).toBeLessThan(
			commandMock.mock.invocationCallOrder[0] ?? 0,
		);
		expect(commandMock).toHaveBeenCalledExactlyOnceWith(
			"plugins.ui.invoke",
			{ slot: SLOT, action: attach.action },
			sessionId,
			withdrawable,
		);
		await host.dispose();
	});

	it("answers no states and unavailable on an older hub, without asking again until it re-registers", async () => {
		const { host, registered } = await createHost();
		commandMock.mockRejectedValue(unsupported);

		await expect(host.pluginUi.get({ sessionId })).resolves.toEqual([]);
		await expect(host.pluginUi.invoke(attach)).resolves.toEqual({
			outcome: "unavailable",
		});
		await expect(host.pluginUi.get({ sessionId })).resolves.toEqual([]);
		expect(commandMock).toHaveBeenCalledOnce();

		commandMock.mockResolvedValue({
			ok: true,
			payload: { states: [envelope] },
		});
		registered();
		await expect(host.pluginUi.get({ sessionId })).resolves.toEqual([envelope]);
		expect(commandMock.mock.calls.slice(1)).toEqual([
			[
				"plugins.ui.invoke",
				{ slot: SLOT, action: attach.action },
				sessionId,
				withdrawable,
			],
			["plugins.ui.get", {}, sessionId, undefined],
		]);
		await host.dispose();
	});

	it("answers unavailable when the hub connection fails", async () => {
		const { host } = await createHost();
		commandMock.mockRejectedValue(new Error("Hub connection closed"));

		await expect(host.pluginUi.invoke(attach)).resolves.toEqual({
			outcome: "unavailable",
		});
		await expect(host.pluginUi.get({ sessionId })).resolves.toEqual([]);
		expect(commandMock).toHaveBeenCalledTimes(2);
		await host.dispose();
	});

	it("re-sends remembered attaches after every re-registration until the session stops", async () => {
		const { host, registered } = await createHost();
		commandMock.mockResolvedValue({ ok: true, payload: { outcome: "ok" } });
		await host.pluginUi.invoke(attach);
		await host.pluginUi.invoke({
			...attach,
			sessionId: "sess-detached",
		});
		await host.pluginUi.invoke({ ...detach, sessionId: "sess-detached" });
		commandMock.mockClear();

		registered();
		await vi.waitFor(() => expect(invokeCalls()).toHaveLength(1));
		expect(invokeCalls()[0]).toEqual([
			"plugins.ui.invoke",
			{ slot: SLOT, action: attach.action },
			sessionId,
			withdrawable,
		]);

		await host.stopSession(sessionId);
		commandMock.mockClear();
		registered();
		await Promise.resolve();
		expect(invokeCalls()).toEqual([]);
		await host.dispose();
	});

	it.each([
		[
			"whose reply was lost with the connection",
			new Error("Hub connection closed"),
		],
		["that an older hub refused", unsupported],
	])("re-sends an attach %s once the client registers again", async (_, failure) => {
		const { host, registered } = await createHost();
		commandMock.mockRejectedValueOnce(failure);
		await expect(host.pluginUi.invoke(attach)).resolves.toEqual({
			outcome: "unavailable",
		});
		commandMock.mockResolvedValue({ ok: true, payload: { outcome: "ok" } });
		commandMock.mockClear();

		registered();
		expect(invokeCalls()).toEqual([
			[
				"plugins.ui.invoke",
				{ slot: SLOT, action: attach.action },
				sessionId,
				withdrawable,
			],
		]);
		await host.dispose();
	});

	it.each([
		[
			"the session detaches",
			(host: HubRuntimeHost) => host.pluginUi.invoke(detach),
		],
		[
			"the host stops the session",
			(host: HubRuntimeHost) => host.stopSession(sessionId),
		],
		["the host is disposed", (host: HubRuntimeHost) => host.dispose()],
	])("withdraws an attach awaiting transport recovery once %s", async (_, withdraw) => {
		const { host } = await createHost();
		const recover = holdNextCommandUntilRecovery();
		commandMock.mockResolvedValue(ok);
		const attaching = host.pluginUi.invoke(attach);

		await withdraw(host);

		await expect(recover()).resolves.toBe("withdrawn");
		await expect(attaching).resolves.toEqual({ outcome: "unavailable" });
		await host.dispose();
	});

	it("withdraws a re-sent attach awaiting transport recovery once the session detaches", async () => {
		const { host, registered } = await createHost();
		commandMock.mockResolvedValue(ok);
		await host.pluginUi.invoke(attach);
		const recover = holdNextCommandUntilRecovery();
		registered();

		await host.pluginUi.invoke(detach);

		await expect(recover()).resolves.toBe("withdrawn");
		expect(invokeCalls().at(-1)).toEqual([
			"plugins.ui.invoke",
			{ slot: SLOT, action: detach.action },
			sessionId,
			undefined,
		]);
		await host.dispose();
	});

	it("still sends an attach awaiting transport recovery while the session stays attached", async () => {
		const { host, registered } = await createHost();
		const recoverFirst = holdNextCommandUntilRecovery();
		commandMock.mockResolvedValue(ok);
		const attaching = host.pluginUi.invoke(attach);
		await host.pluginUi.invoke(attach);

		await expect(recoverFirst()).resolves.toBe("sent");
		await expect(attaching).resolves.toEqual({ outcome: "ok" });

		const recoverResent = holdNextCommandUntilRecovery();
		registered();
		await expect(recoverResent()).resolves.toBe("sent");
		await host.dispose();
	});

	it("does not send an attach twice when its own command triggers the registration", async () => {
		const { host, registered } = await createHost();
		commandMock.mockResolvedValue(ok);
		commandMock.mockImplementationOnce(async () => {
			registered();
			return ok;
		});

		await host.pluginUi.invoke(attach);
		expect(invokeCalls()).toHaveLength(1);

		registered();
		expect(invokeCalls()).toHaveLength(2);
		await host.dispose();
	});

	it("forgets every remembered attach when the host is disposed", async () => {
		const { host, registered } = await createHost();
		commandMock.mockResolvedValue({ ok: true, payload: { outcome: "ok" } });
		await host.pluginUi.invoke(attach);
		commandMock.mockRejectedValueOnce(unsupported);
		await host.pluginUi.invoke({ ...attach, sessionId: "sess-refused" });
		await host.pluginUi.invoke({ ...attach, sessionId: "sess-never-sent" });

		await host.dispose();
		commandMock.mockClear();
		subscribeMock.mockClear();
		registered();

		expect(invokeCalls()).toEqual([]);
		expect(subscribeMock).not.toHaveBeenCalled();
	});

	it.each([
		["declared", [SLOT], [SLOT]],
		["absent", undefined, undefined],
		["empty", [], undefined],
	])("puts a %s catalog on session.create and session.restore", async (_, uiSlots, sent) => {
		const { host } = await createHost();
		commandMock.mockResolvedValue({
			ok: true,
			payload: {
				session: {
					sessionId: "sess-catalog",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
				checkpoint: {},
			},
		});
		const start = {
			config: { ...createConfig(), sessionId: "sess-catalog" },
			source: SessionSource.CORE,
			...(uiSlots ? { uiSlots } : {}),
		};

		await host.startSession(start);
		await host.restoreSession({
			sessionId: "sess-source",
			checkpointRunCount: 1,
			start,
		});

		const payloads = commandMock.mock.calls
			.filter(
				([command]) =>
					command === "session.create" || command === "session.restore",
			)
			.map(([, payload]) => payload as Record<string, unknown>);
		expect(payloads).toHaveLength(2);
		for (const payload of payloads) {
			expect(payload.uiSlots).toEqual(sent);
			expect(Object.hasOwn(payload, "uiSlots")).toBe(sent !== undefined);
		}
		await host.dispose();
	});
});
