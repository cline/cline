import { describe, expect, it } from "vitest";
import { createForkSessionMetadata } from "./fork-metadata";

const origin = {
	forkedFromSessionId: "source",
	forkedAt: "2026-09-24T12:00:00.000Z",
	source: "desktop",
};

describe("createForkSessionMetadata", () => {
	it("replaces lineage and removes handoff markers without mutating the source", () => {
		const metadata = Object.freeze({
			title: "Original title",
			totalCost: 1.25,
			checkpoint: { latest: { ref: "abc", runCount: 2 } },
			fork: { forkedFromSessionId: "older" },
			handoff: { status: "complete" },
			cloudHandoffScope: "scope",
			cloudHandoffIntent: "intent",
			cloudHandoffSeedDispatched: true,
		});
		expect(
			createForkSessionMetadata({ ...origin, metadata, beforeRunCount: 0 }),
		).toEqual({
			title: metadata.title,
			totalCost: metadata.totalCost,
			checkpoint: metadata.checkpoint,
			fork: { ...origin, beforeRunCount: 0, checkpoints: metadata.checkpoint },
		});
	});

	it.each([undefined, null, {}])("accepts empty metadata: %s", (metadata) => {
		expect(createForkSessionMetadata({ ...origin, metadata })).toEqual({
			fork: origin,
		});
	});
});
