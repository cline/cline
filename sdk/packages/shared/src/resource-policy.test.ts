import { describe, expect, it } from "vitest";
import {
	isResourcePolicyProfile,
	parseResourcePolicyProfile,
	RESOURCE_POLICY_VERSION,
} from "./resource-policy";

const validProfile = {
	version: RESOURCE_POLICY_VERSION,
	maxParallelism: 4,
	processMemoryLimitBytes: 2_000_000_000,
	heapMemoryLimitBytes: 1_000_000_000,
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
			maxConcurrent: 2,
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
};

describe("resource policy profiles", () => {
	it("parses a portable versioned profile", () => {
		expect(parseResourcePolicyProfile(validProfile)).toEqual(validProfile);
		expect(isResourcePolicyProfile(validProfile)).toBe(true);
	});

	it.each([
		{ ...validProfile, version: 2 },
		{ ...validProfile, maxParallelism: Number.POSITIVE_INFINITY },
		{ ...validProfile, processMemoryLimitBytes: 0 },
		{
			...validProfile,
			transport: {
				websocket: {
					...validProfile.transport.websocket,
					softWatermarkBytes: 2,
					hardWatermarkBytes: 1,
				},
			},
		},
		{
			...validProfile,
			diagnostics: { ...validProfile.diagnostics, sampleIntervalMs: 1.5 },
		},
		{ ...validProfile, unexpected: true },
	])("rejects invalid or unknown profile shapes", (profile) => {
		expect(isResourcePolicyProfile(profile)).toBe(false);
		expect(() => parseResourcePolicyProfile(profile)).toThrow();
	});
});
