import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	SESSION_SEARCH_PREVIEW_MAX_LENGTH,
	SESSION_SEARCH_TITLE_MAX_LENGTH,
} from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "../../types/sessions";
import { SessionHistorySearchService } from "./session-history-search";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
	return {
		sessionId: "session-1",
		source: "core",
		pid: 1,
		startedAt: "2026-08-19T12:00:00.000Z",
		endedAt: null,
		exitCode: null,
		status: "completed",
		interactive: true,
		provider: "test",
		model: "test-model",
		cwd: "/work/project",
		workspaceRoot: "/work/project",
		enableTools: true,
		enableSpawn: false,
		enableTeams: false,
		isSubagent: false,
		prompt: "Repair the parser",
		metadata: { title: "Parser repair" },
		updatedAt: "2026-08-19T12:01:00.000Z",
		...overrides,
	};
}

describe("SessionHistorySearchService", () => {
	it("indexes session turns and returns ranked snippets", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cline-session-search-"));
		tempDirs.push(dir);
		const sessions = [session()];
		const messages = [
			{ role: "user" as const, content: "Find the frobnicator regression" },
			{
				role: "assistant" as const,
				content: "The issue is in src/parser/session-service.ts",
			},
		];
		const service = new SessionHistorySearchService(
			{
				listSessions: async () => sessions,
				readSessionMessages: async () => messages,
			},
			{ dbPath: join(dir, "search.db") },
		);

		await service.refreshNow();
		const hits = service.search({ query: "session-service" });

		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatchObject({
			sessionId: "session-1",
			ordinal: 1,
			role: "assistant",
			title: "Parser repair",
		});
		expect(hits[0]?.snippet).toContain("[session-service]");
		await service.dispose();
	});

	it("reconciles changed and deleted sessions", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cline-session-search-"));
		tempDirs.push(dir);
		const sessions = [session()];
		let content = "first searchable phrase";
		const service = new SessionHistorySearchService(
			{
				listSessions: async () => sessions,
				readSessionMessages: async () => [{ role: "user", content }],
			},
			{ dbPath: join(dir, "search.db") },
		);

		await service.refreshNow();
		expect(service.search({ query: "first" })).toHaveLength(1);
		content = "second searchable phrase";
		sessions[0] = session({ updatedAt: "2026-08-19T12:02:00.000Z" });
		await service.refreshNow();
		expect(service.search({ query: "first" })).toHaveLength(0);
		expect(service.search({ query: "second" })).toHaveLength(1);

		sessions.splice(0);
		await service.refreshNow();
		expect(service.search({ query: "second" })).toHaveLength(0);
		await service.dispose();
	});

	it("evicts a deleted session without scanning canonical history", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cline-session-search-"));
		tempDirs.push(dir);
		const listSessions = vi.fn(async () => [session()]);
		const service = new SessionHistorySearchService(
			{
				listSessions,
				readSessionMessages: async () => [
					{ role: "user", content: "Find the frobnicator regression" },
				],
			},
			{ dbPath: join(dir, "search.db") },
		);

		await service.refreshNow();
		expect(service.search({ query: "frobnicator" })).toHaveLength(1);
		listSessions.mockClear();

		service.removeSession("session-1");

		expect(service.search({ query: "frobnicator" })).toHaveLength(0);
		expect(service.search({ query: "Parser" })).toHaveLength(0);
		expect(listSessions).not.toHaveBeenCalled();
		await service.dispose();
	});

	it("does not let an in-flight reconciliation restore a deleted session", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cline-session-search-"));
		tempDirs.push(dir);
		const sessions = [session()];
		let blockMessageRead = false;
		let markMessageReadStarted!: () => void;
		let releaseMessageRead!: () => void;
		const messageReadStarted = new Promise<void>((resolve) => {
			markMessageReadStarted = resolve;
		});
		const messageReadReleased = new Promise<void>((resolve) => {
			releaseMessageRead = resolve;
		});
		const service = new SessionHistorySearchService(
			{
				listSessions: async () => sessions,
				readSessionMessages: async () => {
					if (blockMessageRead) {
						markMessageReadStarted();
						await messageReadReleased;
					}
					return [{ role: "user", content: "Find the frobnicator regression" }];
				},
			},
			{ dbPath: join(dir, "search.db") },
		);

		await service.refreshNow();
		blockMessageRead = true;
		sessions[0] = session({ updatedAt: "2026-08-19T12:02:00.000Z" });
		const refresh = service.refreshNow();
		await messageReadStarted;

		service.removeSession("session-1");
		expect(service.search({ query: "frobnicator" })).toHaveLength(0);
		releaseMessageRead();
		await refresh;

		expect(service.search({ query: "frobnicator" })).toHaveLength(0);
		expect(service.search({ query: "Parser" })).toHaveLength(0);
		await service.dispose();
	});

	it("searches session titles when no message artifact is available", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cline-session-search-"));
		tempDirs.push(dir);
		const service = new SessionHistorySearchService(
			{
				listSessions: async () => [
					session({
						metadata: { title: "Generate an image of a puppy" },
					}),
				],
				readSessionMessages: async () => [],
			},
			{ dbPath: join(dir, "search.db") },
		);

		await service.refreshNow();
		expect(service.search({ query: "generate" })).toEqual([
			expect.objectContaining({
				documentId: "session-1:metadata",
				sessionId: "session-1",
				title: "Generate an image of a puppy",
			}),
		]);
		await service.dispose();
	});

	it("bounds oversized titles and unwraps user prompt snippets", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cline-session-search-"));
		tempDirs.push(dir);
		const oversized = "generate an image ".repeat(3_000);
		const wrapped = `<user_input mode="act">${oversized}</user_input>`;
		const service = new SessionHistorySearchService(
			{
				listSessions: async () => [
					session({
						metadata: { title: wrapped },
						prompt: wrapped,
					}),
				],
				readSessionMessages: async () => [{ role: "user", content: wrapped }],
			},
			{ dbPath: join(dir, "search.db") },
		);

		await service.refreshNow();
		const hits = service.search({ query: "generate" });

		expect(hits.length).toBeGreaterThan(0);
		for (const hit of hits) {
			expect(hit.title.length).toBeLessThanOrEqual(
				SESSION_SEARCH_TITLE_MAX_LENGTH,
			);
			expect(hit.snippet.length).toBeLessThanOrEqual(
				SESSION_SEARCH_PREVIEW_MAX_LENGTH,
			);
			expect(hit.title).not.toContain("user_input");
			expect(hit.snippet).not.toContain("user_input");
		}
		await service.dispose();
	});
});
