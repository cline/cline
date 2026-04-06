import { describe, expect, it } from "vitest";
import { formatCheckpointDetail, formatHistoryListLine } from "./history";

describe("formatHistoryListLine", () => {
	it("includes checkpoint metadata when present", () => {
		const line = formatHistoryListLine({
			sessionId: "sess_1",
			provider: "mock-provider",
			model: "mock-model",
			startedAt: "2026-01-01T00:00:00.000Z",
			prompt: "hello world",
			metadata: {
				title: "hello world",
				totalCost: 0.25,
				checkpoint: {
					latest: {
						ref: "abc123",
						createdAt: 1_700_000_000_000,
						runCount: 3,
					},
					history: [
						{ ref: "a", createdAt: 1, runCount: 1 },
						{ ref: "b", createdAt: 2, runCount: 2 },
						{ ref: "c", createdAt: 3, runCount: 3 },
					],
				},
			},
		});

		expect(line).toContain("checkpoints:3 latest-run:3");
	});

	it("formats a compact checkpoint badge summary in the line", () => {
		const line = formatHistoryListLine({
			sessionId: "sess_1",
			provider: "mock-provider",
			model: "mock-model",
			startedAt: "2026-01-01T00:00:00.000Z",
			prompt: "hello world",
			metadata: {
				title: "hello world",
				totalCost: 0.25,
				checkpoint: {
					latest: {
						ref: "abc123",
						createdAt: 1_700_000_000_000,
						runCount: 3,
					},
					history: [
						{ ref: "a", createdAt: 1, runCount: 1 },
						{ ref: "b", createdAt: 2, runCount: 2 },
						{ ref: "c", createdAt: 3, runCount: 3 },
					],
				},
			},
		});

		expect(line).toContain("checkpoints:3 latest-run:3");
	});

	it("formats checkpoint detail text for the selected row footer", () => {
		const detail = formatCheckpointDetail({
			sessionId: "sess_1",
			provider: "mock-provider",
			model: "mock-model",
			startedAt: "2026-01-01T00:00:00.000Z",
			prompt: "hello world",
			metadata: {
				title: "hello world",
				totalCost: 0.25,
				checkpoint: {
					latest: {
						ref: "abc123def4567890",
						createdAt: 1_700_000_000_000,
						runCount: 3,
					},
					history: [
						{ ref: "a", createdAt: 1, runCount: 1 },
						{ ref: "b", createdAt: 2, runCount: 2 },
						{ ref: "c", createdAt: 3, runCount: 3 },
					],
				},
			},
		});

		expect(detail).toContain("Checkpoint");
		expect(detail).toContain("run 3");
		expect(detail).toContain("3 total");
		expect(detail).toContain(
			"clite checkpoint restore latest --session-id sess_1",
		);
	});

	it("omits checkpoint summary when absent", () => {
		const line = formatHistoryListLine({
			sessionId: "sess_1",
			provider: "mock-provider",
			model: "mock-model",
			startedAt: "2026-01-01T00:00:00.000Z",
			prompt: "hello world",
			metadata: {
				title: "hello world",
				totalCost: 0.25,
			},
		});

		expect(line).not.toContain("checkpoints:");
	});
});
