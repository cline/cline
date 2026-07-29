import { afterEach, describe, expect, it, vi } from "vitest";

const { createRuntimeHostMock } = vi.hoisted(() => ({
	createRuntimeHostMock: vi.fn(),
}));

vi.mock("./runtime/host/host", () => ({
	createRuntimeHost: createRuntimeHostMock,
}));

import { ClineCore } from "./ClineCore";

function createHost() {
	return {
		runtimeAddress: undefined,
		startSession: vi.fn(),
		runTurn: vi.fn(),
		getAccumulatedUsage: vi.fn(),
		abort: vi.fn(),
		stopSession: vi.fn(),
		dispose: vi.fn(),
		getSession: vi.fn(async () => undefined),
		listSessions: vi.fn(),
		deleteSession: vi.fn(),
		readSessionMessages: vi.fn(),
		subscribe: vi.fn(() => () => {}),
		updateSessionModel: vi.fn(),
	};
}

afterEach(() => {
	vi.useRealTimers();
	createRuntimeHostMock.mockReset();
});

describe("ClineCore resource diagnostics", () => {
	it("exposes diagnostics and disposes monitoring with the core lifecycle", async () => {
		vi.useFakeTimers();
		const host = createHost();
		createRuntimeHostMock.mockResolvedValue(host);
		const core = await ClineCore.create({
			resourcePolicy: {
				maxParallelism: 2,
				diagnostics: {
					enabled: true,
					sampleIntervalMs: 100,
					eventLoopResolutionMs: 1,
				},
			},
		});
		const listener = vi.fn();
		core.diagnostics.subscribe(listener);

		vi.advanceTimersByTime(100);

		expect(listener).toHaveBeenCalledTimes(1);
		expect(core.diagnostics.policy.profile.maxParallelism).toBe(2);
		expect(core.diagnostics.policy.sources.maxParallelism).toBe("explicit");
		expect(core.diagnostics.getSnapshot().memory.rss).toBeGreaterThan(0);

		await core.dispose();
		vi.advanceTimersByTime(500);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
		expect(host.dispose).toHaveBeenCalledTimes(1);
	});

	it("passes the resolved policy to runtime-host construction", async () => {
		const host = createHost();
		createRuntimeHostMock.mockResolvedValue(host);
		const core = await ClineCore.create({
			resourcePolicy: {
				admission: {
					pendingPrompts: { maxItems: 3 },
					teamRuns: { maxConcurrent: 4 },
				},
			},
		});

		expect(createRuntimeHostMock).toHaveBeenCalledWith(
			expect.objectContaining({
				resourcePolicy: expect.objectContaining({ version: 1 }),
			}),
			expect.objectContaining({
				profile: expect.objectContaining({
					admission: expect.objectContaining({
						pendingPrompts: expect.objectContaining({ maxItems: 3 }),
						teamRuns: expect.objectContaining({ maxConcurrent: 4 }),
					}),
				}),
			}),
		);
		expect(
			core.diagnostics.policy.profile.admission.pendingPrompts.maxItems,
		).toBe(3);
		await core.dispose();
	});
});
