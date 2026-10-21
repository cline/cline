import { describe, expect, it } from "vitest";
import {
	type CheckpointMetadata,
	createRestoredCheckpointMetadata,
	readCheckpointMetadata,
	recordCheckpointEntry,
	recordCheckpointFailure,
	resolveRunCheckpoint,
} from "./checkpoint-records";

const entry = (runCount: number) => ({
	ref: `ref-${runCount}`,
	createdAt: runCount,
	runCount,
});
const failure = (runCount: number) => ({
	runCount,
	createdAt: runCount,
	errorMessage: `run ${runCount} failed`,
});
const session = (checkpoint: CheckpointMetadata) => ({
	metadata: { checkpoint },
});

describe("resolveRunCheckpoint", () => {
	it("uses the run's own checkpoint, or the nearest earlier one for unrecorded runs", () => {
		const metadata = session({ history: [entry(1), entry(3)] });

		expect(resolveRunCheckpoint(metadata, 3)).toEqual({
			status: "available",
			checkpoint: entry(3),
		});
		expect(resolveRunCheckpoint(metadata, 2)).toEqual({
			status: "available",
			checkpoint: entry(1),
		});
	});

	it("does not let an earlier checkpoint stand in for a run that failed", () => {
		const metadata = session({ history: [entry(1)], failures: [failure(2)] });

		expect(resolveRunCheckpoint(metadata, 2)).toEqual({
			status: "failed",
			errorMessage: "run 2 failed",
		});
	});

	it("reports sessions with no checkpoint bookkeeping as unrecorded", () => {
		expect(resolveRunCheckpoint({ metadata: {} }, 1)).toEqual({
			status: "unrecorded",
		});
	});
});

describe("recording checkpoint outcomes", () => {
	it("keeps one outcome per run, the most recent one", () => {
		const failed = recordCheckpointFailure(
			{ history: [entry(1), entry(2)] },
			failure(2),
		);
		expect(failed).toEqual({
			latest: entry(1),
			history: [entry(1)],
			failures: [failure(2)],
		});

		const retried = recordCheckpointEntry(failed, entry(2));
		expect(retried).toEqual({
			latest: entry(2),
			history: [entry(1), entry(2)],
		});
	});

	it("keeps only the newest failures", () => {
		let metadata: CheckpointMetadata = { history: [] };
		for (let runCount = 1; runCount <= 60; runCount++) {
			metadata = recordCheckpointFailure(metadata, failure(runCount));
		}
		expect(metadata.failures).toHaveLength(50);
		expect(metadata.failures?.[0]?.runCount).toBe(11);
	});

	it("reads records written before failures were recorded", () => {
		expect(
			readCheckpointMetadata({
				checkpoint: { latest: entry(1), history: [entry(1), { ref: "" }] },
			}),
		).toEqual({ latest: entry(1), history: [entry(1)] });
	});
});

describe("createRestoredCheckpointMetadata", () => {
	it("carries checkpoints and failures up to the restored run", () => {
		const metadata = session({
			history: [entry(1), entry(3)],
			failures: [failure(2), failure(4)],
		});

		expect(createRestoredCheckpointMetadata(metadata, 3)).toEqual({
			latest: entry(3),
			history: [entry(1), entry(3)],
			failures: [failure(2)],
		});
		expect(createRestoredCheckpointMetadata(metadata, 2)).toEqual({
			latest: entry(1),
			history: [entry(1)],
			failures: [failure(2)],
		});
	});

	it("carries failures when no run produced a checkpoint", () => {
		expect(
			createRestoredCheckpointMetadata(
				session({ history: [], failures: [failure(1)] }),
				1,
			),
		).toEqual({ history: [], failures: [failure(1)] });
	});
});
