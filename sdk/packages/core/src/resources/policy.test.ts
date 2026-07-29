import { describe, expect, it } from "vitest";
import {
	RESOURCE_POLICY_ENV,
	RESOURCE_POLICY_HARD_LIMITS,
	resolveResourcePolicy,
} from "./policy";

const hardware = {
	availableParallelism: 12,
	totalMemoryBytes: 16 * 1024 ** 3,
	heapSizeLimitBytes: 4 * 1024 ** 3,
};

describe("resolveResourcePolicy", () => {
	it("derives finite defaults from hardware", () => {
		const resolved = resolveResourcePolicy({ env: {}, hardware });

		expect(resolved.profile).toMatchObject({
			version: 1,
			maxParallelism: 12,
			processMemoryLimitBytes: 8 * 1024 ** 3,
			heapMemoryLimitBytes: Math.round(4 * 1024 ** 3 * 0.8),
			diagnostics: {
				enabled: true,
				sampleIntervalMs: 5_000,
				eventLoopResolutionMs: 20,
			},
			admission: {
				pendingPrompts: {
					maxItems: 100,
					maxBytes: 1024 * 1024,
					maxItemBytes: 256 * 1024,
				},
				teamRuns: {
					maxConcurrent: 6,
					maxQueued: 100,
					maxMessageBytes: 256 * 1024,
				},
			},
			transport: {
				websocket: {
					softWatermarkBytes: 256 * 1024,
					hardWatermarkBytes: 1024 * 1024,
					congestionGraceMs: 5_000,
					closeGraceMs: 1_000,
					maxInboundPayloadBytes: 1024 * 1024,
				},
			},
			streaming: { flushIntervalMs: 32, maxBatchBytes: 64 * 1024 },
		});
		expect(resolved.sources).toEqual({
			maxParallelism: "hardware",
			processMemoryLimitBytes: "hardware",
			heapMemoryLimitBytes: "hardware",
			diagnostics: {
				enabled: "default",
				sampleIntervalMs: "default",
				eventLoopResolutionMs: "default",
			},
			admission: {
				pendingPrompts: {
					maxItems: "default",
					maxBytes: "default",
					maxItemBytes: "default",
				},
				teamRuns: {
					maxConcurrent: "default",
					maxQueued: "default",
					maxMessageBytes: "default",
				},
			},
			transport: {
				websocket: {
					softWatermarkBytes: "default",
					hardWatermarkBytes: "default",
					congestionGraceMs: "default",
					closeGraceMs: "default",
					maxInboundPayloadBytes: "default",
				},
			},
			streaming: {
				flushIntervalMs: "default",
				maxBatchBytes: "default",
			},
		});
	});

	it("applies explicit values over environment values with attribution", () => {
		const resolved = resolveResourcePolicy({
			hardware,
			env: {
				[RESOURCE_POLICY_ENV.maxParallelism]: "7",
				[RESOURCE_POLICY_ENV.processMemoryLimitBytes]: "900000000",
				[RESOURCE_POLICY_ENV.diagnosticsEnabled]: "off",
				[RESOURCE_POLICY_ENV.diagnosticsSampleIntervalMs]: "2500",
				[RESOURCE_POLICY_ENV.teamRunMaxQueued]: "25",
				[RESOURCE_POLICY_ENV.websocketHardWatermarkBytes]: "4096",
			},
			overrides: {
				maxParallelism: 3,
				diagnostics: { enabled: true },
				admission: { pendingPrompts: { maxItems: 7 } },
				transport: { websocket: { softWatermarkBytes: 2048 } },
			},
		});

		expect(resolved.profile.maxParallelism).toBe(3);
		expect(resolved.profile.processMemoryLimitBytes).toBe(900_000_000);
		expect(resolved.profile.diagnostics).toMatchObject({
			enabled: true,
			sampleIntervalMs: 2_500,
		});
		expect(resolved.sources.maxParallelism).toBe("explicit");
		expect(resolved.sources.processMemoryLimitBytes).toBe("environment");
		expect(resolved.sources.diagnostics.enabled).toBe("explicit");
		expect(resolved.sources.diagnostics.sampleIntervalMs).toBe("environment");
		expect(resolved.profile.admission.pendingPrompts.maxItems).toBe(7);
		expect(resolved.profile.admission.teamRuns.maxQueued).toBe(25);
		expect(resolved.profile.transport.websocket).toMatchObject({
			softWatermarkBytes: 2048,
			hardWatermarkBytes: 4096,
		});
		expect(resolved.sources.admission.pendingPrompts.maxItems).toBe("explicit");
		expect(resolved.sources.admission.teamRuns.maxQueued).toBe("environment");
	});

	it("hard-clamps non-finite and out-of-range values", () => {
		const resolved = resolveResourcePolicy({
			hardware,
			env: {
				[RESOURCE_POLICY_ENV.processMemoryLimitBytes]: "-Infinity",
				[RESOURCE_POLICY_ENV.heapMemoryLimitBytes]: "Infinity",
			},
			overrides: {
				maxParallelism: Number.POSITIVE_INFINITY,
				diagnostics: {
					sampleIntervalMs: -50,
					eventLoopResolutionMs: Number.POSITIVE_INFINITY,
				},
				admission: {
					teamRuns: { maxConcurrent: Number.POSITIVE_INFINITY },
				},
				transport: {
					websocket: {
						softWatermarkBytes: Number.POSITIVE_INFINITY,
						hardWatermarkBytes: 2048,
					},
				},
			},
		});

		expect(resolved.profile.maxParallelism).toBe(
			RESOURCE_POLICY_HARD_LIMITS.maxParallelism.max,
		);
		expect(resolved.profile.processMemoryLimitBytes).toBe(
			RESOURCE_POLICY_HARD_LIMITS.processMemoryLimitBytes.min,
		);
		expect(resolved.profile.heapMemoryLimitBytes).toBe(
			RESOURCE_POLICY_HARD_LIMITS.heapMemoryLimitBytes.max,
		);
		expect(resolved.profile.diagnostics.sampleIntervalMs).toBe(
			RESOURCE_POLICY_HARD_LIMITS.diagnosticsSampleIntervalMs.min,
		);
		expect(resolved.profile.diagnostics.eventLoopResolutionMs).toBe(
			RESOURCE_POLICY_HARD_LIMITS.eventLoopResolutionMs.max,
		);
		expect(resolved.profile.admission.teamRuns.maxConcurrent).toBe(
			RESOURCE_POLICY_HARD_LIMITS.teamRunMaxConcurrent.max,
		);
		expect(resolved.profile.transport.websocket.softWatermarkBytes).toBe(2048);
		const nanOverride = resolveResourcePolicy({
			hardware,
			env: { [RESOURCE_POLICY_ENV.maxParallelism]: "7" },
			overrides: { maxParallelism: Number.NaN },
		});
		expect(nanOverride.profile.maxParallelism).toBe(12);
		expect(nanOverride.sources.maxParallelism).toBe("explicit");

		for (const value of [
			resolved.profile.maxParallelism,
			resolved.profile.processMemoryLimitBytes,
			resolved.profile.heapMemoryLimitBytes,
			resolved.profile.diagnostics.sampleIntervalMs,
			resolved.profile.diagnostics.eventLoopResolutionMs,
		]) {
			expect(Number.isFinite(value)).toBe(true);
		}
	});
});
