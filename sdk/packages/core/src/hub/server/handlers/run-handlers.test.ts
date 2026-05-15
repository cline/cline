import type { HubEventEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeHost } from "../../../runtime/host/runtime-host";
import { buildHubEvent, type HubTransportContext } from "./context";
import { handleSessionInput } from "./run-handlers";

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
		sessionHost: {
			startSession: vi.fn(),
			runTurn: vi.fn(),
			restoreSession: vi.fn(),
			abort: vi.fn().mockResolvedValue(undefined),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(),
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
});
