import { afterEach, describe, expect, it, vi } from "vitest";
import { requestCapability } from "./capability-handlers";
import type { HubTransportContext } from "./context";

type PublishedEvent = {
	event: string;
	payload?: Record<string, unknown>;
};

function fakeContext(): {
	ctx: HubTransportContext;
	published: PublishedEvent[];
} {
	const published: PublishedEvent[] = [];
	const ctx = {
		pendingCapabilityRequests: new Map(),
		publish: (event: PublishedEvent) => {
			published.push(event);
		},
		buildEvent: (
			event: string,
			payload: Record<string, unknown>,
			sessionId: string,
		) => ({ event, payload, sessionId }),
	} as unknown as HubTransportContext;
	return { ctx, published };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("requestCapability timeout", () => {
	it("rejects and clears the pending request when the client never answers", async () => {
		vi.useFakeTimers();
		const { ctx, published } = fakeContext();

		const request = requestCapability(
			ctx,
			"session-1",
			"hook.afterRun",
			{ context: {} },
			"client-1",
			undefined,
			25,
		);
		const rejection = expect(request).rejects.toThrow(
			"Capability hook.afterRun timed out after 25ms waiting for client-1.",
		);
		await vi.advanceTimersByTimeAsync(25);
		await rejection;

		expect(ctx.pendingCapabilityRequests.size).toBe(0);
		expect(published).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					event: "capability.resolved",
					payload: expect.objectContaining({
						ok: false,
						cancelled: true,
						capabilityName: "hook.afterRun",
					}),
				}),
			]),
		);
	});

	it("cancels the timeout once the client answers", async () => {
		vi.useFakeTimers();
		const { ctx, published } = fakeContext();

		const request = requestCapability(
			ctx,
			"session-1",
			"hook.afterRun",
			{ context: {} },
			"client-1",
			undefined,
			1_000,
		);
		const requestId = [...ctx.pendingCapabilityRequests.keys()][0];
		const pending = ctx.pendingCapabilityRequests.get(requestId);
		if (!pending) throw new Error("missing pending capability request");
		ctx.pendingCapabilityRequests.delete(requestId);
		pending.resolve({ ok: true, payload: { control: { stop: true } } });

		await expect(request).resolves.toEqual({ control: { stop: true } });
		await vi.advanceTimersByTimeAsync(1_000);
		expect(
			published.some(
				(event) =>
					event.event === "capability.resolved" &&
					event.payload?.cancelled === true,
			),
		).toBe(false);
	});

	it("does not schedule a timeout when none is requested", async () => {
		const { ctx } = fakeContext();
		const request = requestCapability(
			ctx,
			"session-1",
			"hook.beforeRun",
			{ context: {} },
			"client-1",
		);
		const requestId = [...ctx.pendingCapabilityRequests.keys()][0];
		const pending = ctx.pendingCapabilityRequests.get(requestId);
		if (!pending) throw new Error("missing pending capability request");
		ctx.pendingCapabilityRequests.delete(requestId);
		pending.resolve({ ok: true, payload: { context: "kept" } });

		await expect(request).resolves.toEqual({ context: "kept" });
	});
});
