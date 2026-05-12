import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionHistoryRecord } from "@cline/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	formatCheckpointDetail,
	formatHistoryListLine,
	runHistoryExport,
	runHistoryList,
} from "./history";

vi.mock("../session/session", () => ({
	listSessions: vi.fn(),
	readSessionMessagesArtifact: vi.fn(),
}));

vi.mock("../tui/history-standalone", () => ({
	renderHistoryStandalone: vi.fn(async () => 0),
}));

import { listSessions, readSessionMessagesArtifact } from "../session/session";
import { renderHistoryStandalone } from "../tui/history-standalone";

const mockedReadSessionMessagesArtifact = vi.mocked(
	readSessionMessagesArtifact,
);
const mockedListSessions = vi.mocked(listSessions);
const mockedRenderHistoryStandalone = vi.mocked(renderHistoryStandalone);

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

	it("omits cost for subscription-backed providers", () => {
		const line = formatHistoryListLine(
			createHistoryRow({
				provider: "openai-codex",
				model: "gpt-5.4",
				metadata: {
					title: "hello world",
					totalCost: 0.25,
				},
			}),
		);

		expect(line).toContain("openai-codex:gpt-5.4 | hello world");
		expect(line).not.toContain("$0.25");
	});
});

describe("runHistoryList", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("hydrates interactive history rows so titles can be inferred from messages", async () => {
		const row = createHistoryRow({ prompt: undefined, metadata: undefined });
		mockedListSessions.mockResolvedValue([row]);
		const io = {
			writeln: vi.fn(),
			writeErr: vi.fn(),
		};

		const code = await runHistoryList({
			limit: 25,
			outputMode: "text",
			io,
		});

		expect(code).toBe(0);
		expect(mockedListSessions).toHaveBeenCalledWith(25, {
			hydrate: true,
		});
		expect(mockedRenderHistoryStandalone).toHaveBeenCalledWith(
			expect.objectContaining({ rows: [row] }),
		);
	});

	it("keeps json history listing unhydrated", async () => {
		const row = createHistoryRow({ prompt: undefined, metadata: undefined });
		mockedListSessions.mockResolvedValue([row]);
		const writeSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		const code = await runHistoryList({
			limit: 25,
			outputMode: "json",
		});

		expect(code).toBe(0);
		expect(mockedListSessions).toHaveBeenCalledWith(25, {
			hydrate: false,
		});
		expect(writeSpy).toHaveBeenCalledWith(JSON.stringify([row]));
		writeSpy.mockRestore();
	});

	it("defaults history listing to 50 rows", async () => {
		mockedListSessions.mockResolvedValue([]);
		const io = {
			writeln: vi.fn(),
			writeErr: vi.fn(),
		};

		const code = await runHistoryList({
			limit: Number.NaN,
			outputMode: "text",
			io,
		});

		expect(code).toBe(0);
		expect(mockedListSessions).toHaveBeenCalledWith(50, {
			hydrate: true,
		});
		expect(io.writeln).toHaveBeenCalledWith("No history found.");
	});
});

describe("runHistoryExport", () => {
	let tempDir = "";

	afterEach(async () => {
		vi.clearAllMocks();
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
			tempDir = "";
		}
	});

	it("writes standalone html from a persisted messages artifact", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "cline-history-export-"));
		const outputPath = join(tempDir, "export.html");
		const artifact = {
			version: 1,
			updated_at: "2026-04-22T17:42:10.123Z",
			sessionId: "sess_1",
			messages: [
				{
					id: "m1",
					role: "user",
					content: [{ type: "text", text: "hello" }],
				},
				{
					id: "m2",
					role: "assistant",
					content: [{ type: "text", text: "world" }],
				},
			],
		} satisfies NonNullable<
			Awaited<ReturnType<typeof readSessionMessagesArtifact>>
		>;
		mockedReadSessionMessagesArtifact.mockResolvedValue(artifact);
		const io = {
			writeln: vi.fn(),
			writeErr: vi.fn(),
		};

		const code = await runHistoryExport("sess_1", outputPath, "text", io);

		expect(code).toBe(0);
		expect(io.writeErr).not.toHaveBeenCalled();
		expect(io.writeln).toHaveBeenCalledWith(
			expect.stringContaining(outputPath),
		);
		await expect(readFile(outputPath, "utf8")).resolves.toContain("world");
	});

	it("fails when the session artifact is missing", async () => {
		mockedReadSessionMessagesArtifact.mockResolvedValue(undefined);
		const io = {
			writeln: vi.fn(),
			writeErr: vi.fn(),
		};

		const code = await runHistoryExport("sess_missing", undefined, "text", io);

		expect(code).toBe(1);
		expect(io.writeErr).toHaveBeenCalledWith(
			"Session sess_missing not found or has no messages.json",
		);
	});
});
