import type { SessionHistoryRecord } from "@clinebot/core";
import { describe, expect, it } from "vitest";
import { formatCheckpointDetail, formatHistoryListLine } from "./history";

function createHistoryRow(
	overrides: Partial<SessionHistoryRecord> = {},
): SessionHistoryRecord {
	return {
		sessionId: "sess_1",
		source: "cli",
		pid: 1,
		startedAt: "2026-01-01T00:00:00.000Z",
		status: "completed",
		interactive: false,
		provider: "mock-provider",
		model: "mock-model",
		cwd: "/tmp/workspace",
		workspaceRoot: "/tmp/workspace",
		enableTools: true,
		enableSpawn: false,
		enableTeams: false,
		isSubagent: false,
		prompt: "hello world",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("formatHistoryListLine", () => {
	it("includes checkpoint metadata when present", () => {
		const line = formatHistoryListLine(
			createHistoryRow({
				metadata: {
					title: "hello world",
					totalCost: 0.25,
					checkpoint: {
						latest: {
							ref: "abc123",
							createdAt: 1767196800000,
							runCount: 3,
						},
						history: [
							{ ref: "a", createdAt: 1, runCount: 1 },
							{ ref: "b", createdAt: 2, runCount: 2 },
							{ ref: "c", createdAt: 3, runCount: 3 },
						],
					},
				},
			}),
		);

		expect(line).toContain(
			"12/31/2025 16:00 mock-provider:mock-model | $0.25 | hello world",
		);
	});

	it("formats a compact checkpoint badge summary in the line", () => {
		const line = formatHistoryListLine(
			createHistoryRow({
				metadata: {
					title: "hello world",
					totalCost: 0.25,
					checkpoint: {
						latest: {
							ref: "abc123",
							createdAt: 1767196800000,
							runCount: 3,
						},
						history: [
							{ ref: "a", createdAt: 1, runCount: 1 },
							{ ref: "b", createdAt: 2, runCount: 2 },
							{ ref: "c", createdAt: 3, runCount: 3 },
						],
					},
				},
			}),
		);

		expect(line).toContain(
			"12/31/2025 16:00 mock-provider:mock-model | $0.25 | hello world",
		);
		expect(line).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
	});

	it("formats checkpoint detail text for the selected row footer", () => {
		const detail = formatCheckpointDetail(
			createHistoryRow({
				metadata: {
					title: "hello world",
					totalCost: 0.25,
					checkpoint: {
						latest: {
							ref: "abc123def4567890",
							createdAt: 1767196800000,
							runCount: 3,
						},
						history: [
							{ ref: "a", createdAt: 1, runCount: 1 },
							{ ref: "b", createdAt: 2, runCount: 2 },
							{ ref: "c", createdAt: 3, runCount: 3 },
						],
					},
				},
			}),
		);

		expect(detail).toContain("Checkpoint");
		expect(detail).toContain("run 3");
		expect(detail).toContain("3 total");
		expect(detail).toContain(
			"clite checkpoint restore latest --session-id sess_1",
		);
	});

	it("omits checkpoint summary when absent", () => {
		const line = formatHistoryListLine(
			createHistoryRow({
				metadata: {
					title: "hello world",
					totalCost: 0.25,
				},
			}),
		);

		expect(line).not.toContain("checkpoints:");
	});
});
