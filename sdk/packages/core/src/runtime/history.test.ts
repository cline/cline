import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "../types/sessions";
import { hydrateSessionHistory, listSessionHistory } from "./history";

const originalSessionDataDir = process.env.CLINE_SESSION_DATA_DIR;

let tempSessionDataDir = "";

function createRow(
	overrides: Partial<SessionRecord> & Pick<SessionRecord, "sessionId">,
): SessionRecord {
	return {
		source: "cli",
		pid: 1,
		startedAt: "2026-04-21T02:17:46.169Z",
		status: "completed",
		interactive: false,
		provider: "",
		model: "",
		cwd: "/tmp/workspace",
		workspaceRoot: "/tmp/workspace",
		enableTools: true,
		enableSpawn: false,
		enableTeams: false,
		isSubagent: false,
		updatedAt: "2026-04-21T02:17:46.169Z",
		...overrides,
	};
}

async function writeManifest(
	sessionId: string,
	manifest: Record<string, unknown>,
): Promise<void> {
	const sessionDir = join(tempSessionDataDir, sessionId);
	const completeManifest = {
		version: 1,
		session_id: sessionId,
		source: "cli",
		pid: 1,
		started_at: "2026-04-20T00:00:00.000Z",
		status: "completed",
		interactive: false,
		provider: "cline",
		model: "anthropic/claude-sonnet-4.6",
		cwd: "/tmp/workspace",
		workspace_root: "/tmp/workspace",
		enable_tools: true,
		enable_spawn: false,
		enable_teams: false,
		...manifest,
	};
	await mkdir(sessionDir, { recursive: true });
	await writeFile(
		join(sessionDir, `${sessionId}.json`),
		`${JSON.stringify(completeManifest, null, 2)}\n`,
		"utf8",
	);
}

describe("session history", () => {
	afterEach(async () => {
		vi.clearAllMocks();
		if (tempSessionDataDir) {
			await rm(tempSessionDataDir, { recursive: true, force: true });
			tempSessionDataDir = "";
		}
		if (originalSessionDataDir === undefined) {
			delete process.env.CLINE_SESSION_DATA_DIR;
		} else {
			process.env.CLINE_SESSION_DATA_DIR = originalSessionDataDir;
		}
	});

	it("preserves rows that already have history display metadata", async () => {
		const readMessages = vi.fn();
		const rows = await hydrateSessionHistory({ readMessages }, [
			createRow({
				sessionId: "sess_1",
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				prompt: "hello",
				metadata: {
					title: "hello",
					totalCost: 0.02,
				},
			}),
		]);

		expect(rows).toEqual([
			expect.objectContaining({
				sessionId: "sess_1",
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				metadata: expect.objectContaining({
					title: "hello",
					totalCost: 0.02,
				}),
			}),
		]);
		expect(readMessages).not.toHaveBeenCalled();
	});

	it("hydrates missing provider, model, and cost from stored messages", async () => {
		const readMessages = vi.fn().mockResolvedValue([
			{
				role: "user",
				content: [{ type: "text", text: "hello" }],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "hi" }],
				modelInfo: {
					provider: "cline",
					id: "anthropic/claude-sonnet-4.6",
				},
				metrics: {
					cost: 0.02,
				},
			},
		]);

		const [row] = await hydrateSessionHistory({ readMessages }, [
			createRow({
				sessionId: "sess_2",
				prompt: "hello",
				metadata: {},
			}),
		]);

		expect(readMessages).toHaveBeenCalledWith("sess_2");
		expect(row).toMatchObject({
			sessionId: "sess_2",
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			metadata: {
				title: "hello",
				totalCost: 0.02,
			},
		});
	});

	it("falls back to nested metadata provider/model ids before reading messages", async () => {
		const readMessages = vi.fn().mockResolvedValue([]);

		const [row] = await hydrateSessionHistory({ readMessages }, [
			createRow({
				sessionId: "sess_3",
				metadata: {
					title: "hello",
					provider: { id: "cline" },
					model: { id: "anthropic/claude-haiku-4.5" },
				},
			}),
		]);

		expect(row.provider).toBe("cline");
		expect(row.model).toBe("anthropic/claude-haiku-4.5");
		expect(readMessages).toHaveBeenCalledWith("sess_3");
	});

	it("preserves host ordering when no manifest fallback rows are merged", async () => {
		const readMessages = vi.fn().mockResolvedValue([]);
		const first = createRow({
			sessionId: "sess_first",
			startedAt: "2026-04-19T00:00:00.000Z",
		});
		const second = createRow({
			sessionId: "sess_second",
			startedAt: "2026-04-20T00:00:00.000Z",
		});

		const rows = await listSessionHistory(
			{
				list: vi.fn().mockResolvedValue([first, second]),
				readMessages,
			},
			{ limit: 2 },
		);

		expect(rows.map((row) => row.sessionId)).toEqual([
			"sess_first",
			"sess_second",
		]);
	});

	it("passes zero limits through without forcing a row", async () => {
		const list = vi.fn().mockResolvedValue([
			createRow({
				sessionId: "sess_4",
			}),
		]);
		const readMessages = vi.fn();

		const rows = await listSessionHistory({ list, readMessages }, { limit: 0 });

		expect(list).toHaveBeenCalledWith(0);
		expect(rows).toEqual([]);
		expect(readMessages).not.toHaveBeenCalled();
	});

	it("can list lightweight history without hydrating messages", async () => {
		const list = vi.fn().mockResolvedValue([
			createRow({
				sessionId: "sess_lightweight",
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				metadata: { title: "stored title" },
			}),
		]);
		const readMessages = vi.fn();

		const rows = await listSessionHistory(
			{ list, readMessages },
			{ limit: 10, hydrate: false },
		);

		expect(list).toHaveBeenCalledWith(10);
		expect(readMessages).not.toHaveBeenCalled();
		expect(rows).toEqual([
			expect.objectContaining({
				sessionId: "sess_lightweight",
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				metadata: expect.objectContaining({ title: "stored title" }),
			}),
		]);
	});

	it("merges manifest fallback rows when the backend list is short", async () => {
		tempSessionDataDir = await mkdtemp(join(tmpdir(), "cline-core-history-"));
		process.env.CLINE_SESSION_DATA_DIR = tempSessionDataDir;
		await writeManifest("sess_1800000000000", {
			session_id: "sess_1800000000000",
			started_at: "2026-04-20T00:00:00.000Z",
			source: "cli",
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			cwd: "/tmp/workspace",
			workspace_root: "/tmp/workspace",
			prompt: "manifest prompt",
			metadata: {
				title: "manifest title",
				totalCost: 0.03,
			},
		});
		await writeManifest("sess_1700000000000", {
			session_id: "sess_1700000000000",
			started_at: "2026-04-19T00:00:00.000Z",
			source: "cli",
			provider: "cline",
			model: "anthropic/claude-haiku-4.5",
			cwd: "/tmp/workspace",
			workspace_root: "/tmp/workspace",
			prompt: "older manifest prompt",
		});

		const readMessages = vi.fn().mockResolvedValue([]);
		const rows = await listSessionHistory(
			{
				list: vi.fn().mockResolvedValue([
					createRow({
						sessionId: "sess_backend",
						startedAt: "2026-04-21T00:00:00.000Z",
						provider: "cline",
						model: "anthropic/claude-opus-4.1",
						metadata: {
							title: "backend title",
							totalCost: 0.05,
						},
					}),
				]),
				readMessages,
			},
			{
				limit: 3,
				includeManifestFallback: true,
			},
		);

		expect(rows.map((row) => row.sessionId)).toEqual([
			"sess_backend",
			"sess_1800000000000",
			"sess_1700000000000",
		]);
		expect(rows[1]).toMatchObject({
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			prompt: "manifest prompt",
			metadata: {
				title: "manifest title",
				totalCost: 0.03,
			},
		});
		expect(readMessages).toHaveBeenCalledWith("sess_1700000000000");
	});
});
