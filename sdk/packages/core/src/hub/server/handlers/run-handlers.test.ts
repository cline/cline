import type { HubEventEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeHost } from "../../../runtime/host/runtime-host";
import { buildHubEvent, type HubTransportContext } from "./context";
import { handleRunAbort, handleSessionInput } from "./run-handlers";

function createContext(
	overrides: Partial<RuntimeHost> = {},
): HubTransportContext & { events: HubEventEnvelope[] } {
	const events: HubEventEnvelope[] = [];
	return {
		clients: new Map(),
		sessionState: new Map(),
		pendingApprovals: new Map(),
		pendingCapabilityRequests: new Map(),
		suppressNextTerminalEventBySession: new Map(),
		activeRpcTurnCountBySession: new Map(),
		sessionHost: {
			startSession: vi.fn(),
			runTurn: vi.fn(),
			restoreSession: vi.fn(),
			abort: vi.fn().mockResolvedValue(undefined),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn().mockImplementation(async (sessionId: string) => ({
				sessionId,
			})),
			listSessions: vi.fn(),
			...overrides,
		} as RuntimeHost,
		publish: (event) => {
			events.push(event);
		},
		buildEvent: buildHubEvent,
		requestCapability: vi.fn(),
		events,
	};
}

describe("run handlers", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("correlates run start with the accepted command", async () => {
		const runTurn = vi.fn().mockResolvedValue(undefined);
		const ctx = createContext({ runTurn });

		await expect(
			handleSessionInput(ctx, {
				version: "v1",
				command: "session.send_input",
				requestId: "req-input",
				clientId: "client-1",
				sessionId: "session-1",
				payload: { prompt: "go" },
			}),
		).resolves.toMatchObject({ ok: true });

		expect(runTurn).toHaveBeenCalledOnce();
		expect(ctx.events).toContainEqual(
			expect.objectContaining({
				event: "run.started",
				payload: {
					clientId: "client-1",
					requestId: "req-input",
				},
				sessionId: "session-1",
			}),
		);
	});

	it("does not publish run start for an unknown session", async () => {
		const runTurn = vi.fn();
		const ctx = createContext({
			getSession: vi.fn().mockResolvedValue(undefined),
			runTurn,
		});

		await expect(
			handleSessionInput(ctx, {
				version: "v1",
				command: "session.send_input",
				requestId: "req-missing",
				clientId: "client-1",
				sessionId: "missing-session",
				payload: { prompt: "go" },
			}),
		).resolves.toMatchObject({
			error: { code: "session_not_found" },
			ok: false,
		});

		expect(runTurn).not.toHaveBeenCalled();
		expect(ctx.events).not.toContainEqual(
			expect.objectContaining({ event: "run.started" }),
		);
	});

	it("aborts through the runtime host when a run timeout is configured", async () => {
		vi.useFakeTimers();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const abort = vi.fn().mockResolvedValue(undefined);
		const ctx = createContext({
			runTurn: vi.fn(() => new Promise<undefined>(() => {})),
			abort,
		});

		const promise = handleSessionInput(ctx, {
			version: "v1",
			command: "run.start",
			requestId: "req-timeout",
			sessionId: "session-1",
			payload: {
				sessionId: "session-1",
				prompt: "go",
				timeoutMs: 50,
			},
		});
		const expectation = expect(promise).rejects.toThrow(
			"Hub run run.start timed out after 50ms.",
		);

		await vi.advanceTimersByTimeAsync(51);

		await expectation;
		expect(abort).toHaveBeenCalledWith(
			"session-1",
			"Hub run run.start timed out after 50ms.",
		);
		expect(ctx.events).toContainEqual(
			expect.objectContaining({
				event: "run.failed",
				payload: expect.objectContaining({
					error: "Hub run run.start timed out after 50ms.",
				}),
			}),
		);
	});

	it("rejects promptly when timeout abort remains pending", async () => {
		vi.useFakeTimers();
		vi.spyOn(console, "error").mockImplementation(() => {});
		let resolveAbort: (() => void) | undefined;
		const abort = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveAbort = resolve;
				}),
		);
		const ctx = createContext({
			runTurn: vi.fn(() => new Promise<undefined>(() => {})),
			abort,
		});

		let rejection: string | undefined;
		const promise = handleSessionInput(ctx, {
			version: "v1",
			command: "run.start",
			requestId: "req-timeout-prompt",
			sessionId: "session-1",
			payload: {
				sessionId: "session-1",
				prompt: "go",
				timeoutMs: 50,
			},
		}).catch((error: unknown) => {
			rejection = error instanceof Error ? error.message : String(error);
		});

		await vi.advanceTimersByTimeAsync(51);

		expect(rejection).toBe("Hub run run.start timed out after 50ms.");
		expect(abort).toHaveBeenCalledWith(
			"session-1",
			"Hub run run.start timed out after 50ms.",
		);

		resolveAbort?.();
		await promise;
	});

	it("publishes heartbeat events while a run remains pending", async () => {
		vi.useFakeTimers();
		vi.spyOn(console, "error").mockImplementation(() => {});
		let resolveRun: ((result: undefined) => void) | undefined;
		const ctx = createContext({
			runTurn: vi.fn(
				() =>
					new Promise<undefined>((resolve) => {
						resolveRun = resolve;
					}),
			),
		});

		const promise = handleSessionInput(ctx, {
			version: "v1",
			command: "run.start",
			requestId: "req-heartbeat",
			sessionId: "session-1",
			payload: { sessionId: "session-1", prompt: "go" },
		});

		await vi.advanceTimersByTimeAsync(30_001);

		expect(ctx.events).toContainEqual(
			expect.objectContaining({
				event: "run.heartbeat",
				sessionId: "session-1",
				payload: expect.objectContaining({
					requestId: "req-heartbeat",
					elapsedMs: expect.any(Number),
				}),
			}),
		);

		resolveRun?.(undefined);
		await expect(promise).resolves.toMatchObject({ ok: true });
	});

	it("tracks the in-flight RPC turn for the projector while runTurn is pending", async () => {
		let resolveRun: ((result: undefined) => void) | undefined;
		const ctx = createContext({
			runTurn: vi.fn(
				() =>
					new Promise<undefined>((resolve) => {
						resolveRun = resolve;
					}),
			),
		});

		const promise = handleSessionInput(ctx, {
			version: "v1",
			command: "run.start",
			requestId: "req-track",
			sessionId: "session-1",
			payload: { sessionId: "session-1", prompt: "go" },
		});
		await Promise.resolve();

		expect(ctx.activeRpcTurnCountBySession.get("session-1")).toBe(1);

		resolveRun?.(undefined);
		await expect(promise).resolves.toMatchObject({ ok: true });
		expect(ctx.activeRpcTurnCountBySession.has("session-1")).toBe(false);
	});

	it("clears the in-flight RPC turn when runTurn rejects", async () => {
		const ctx = createContext({
			runTurn: vi.fn().mockRejectedValue(new Error("boom")),
		});

		await expect(
			handleSessionInput(ctx, {
				version: "v1",
				command: "run.start",
				requestId: "req-track-reject",
				sessionId: "session-1",
				payload: { sessionId: "session-1", prompt: "go" },
			}),
		).rejects.toThrow("boom");

		expect(ctx.activeRpcTurnCountBySession.has("session-1")).toBe(false);
		expect(ctx.events).toContainEqual(
			expect.objectContaining({
				event: "run.failed",
				payload: expect.objectContaining({ error: "boom" }),
			}),
		);
	});

	it("treats abort as applied when the runtime abort hook rejects", async () => {
		const abort = vi.fn().mockRejectedValue(new Error("Run aborted"));
		const ctx = createContext({ abort });

		const reply = await handleRunAbort(ctx, {
			version: "v1",
			command: "run.abort",
			requestId: "req-abort",
			clientId: "client-1",
			sessionId: "session-1",
			payload: {
				sessionId: "session-1",
				reason: "user cancelled",
			},
		});

		expect(reply).toMatchObject({
			ok: true,
			payload: { applied: true },
		});
		expect(abort).toHaveBeenCalledWith("session-1", "user cancelled");
	});
});
