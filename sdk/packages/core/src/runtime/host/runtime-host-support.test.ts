import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readPersistedMessagesFile } from "./runtime-host-support";
import { appendMessagesToJsonl, ensureJsonlHeader } from "../../services/session-messages-jsonl";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.allSettled(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

describe("readPersistedMessagesFile", () => {
	it("returns persisted messages verbatim, wrappers included", async () => {
		// The user_input wrapper records which mode each message was sent in
		// and session restarts re-seed through this read path, so stripping
		// here would destroy that history a little more on every restart.
		// Display surfaces format for themselves via formatDisplayUserInput.
		const dir = await mkdtemp(join(tmpdir(), "runtime-host-support-"));
		tempDirs.push(dir);
		const messagesPath = join(dir, "messages.json");
		await writeFile(
			messagesPath,
			JSON.stringify([
				{
					role: "user",
					content: '<user_input mode="act">spawn a team of agents</user_input>',
				},
				{
					role: "assistant",
					content: "Working on it.",
				},
				{
					role: "user",
					content: [
						{
							type: "text",
							text: '<user_input mode="plan"><mode_notice>The user switched from act mode to plan mode before sending this message.</mode_notice>\ninspect repo</user_input>',
						},
					],
				},
			]),
			"utf8",
		);

		const messages = await readPersistedMessagesFile(messagesPath);

		expect(messages[0]?.content).toBe(
			'<user_input mode="act">spawn a team of agents</user_input>',
		);
		expect(messages[1]?.content).toBe("Working on it.");
		expect(messages[2]?.content).toEqual([
			{
				type: "text",
				text: '<user_input mode="plan"><mode_notice>The user switched from act mode to plan mode before sending this message.</mode_notice>\ninspect repo</user_input>',
			},
		]);
	});

	it("returns the FULL conversation by default (no tail-window truncation)", async () => {
		// Regression: a default `limit: 50` on the read path made
		// getStateToPostToWebview compute isTruncated as 50 > 50 === false,
		// silently disabling scroll-up pagination — and loadHistoryBatch could
		// never locate messages older than the window, so session billing
		// ($0.00) and compaction saw only the last 50 rows.
		const dir = await mkdtemp(join(tmpdir(), "runtime-host-support-"));
		tempDirs.push(dir);
		const messagesPath = join(dir, "messages.jsonl");
		ensureJsonlHeader(messagesPath, { updatedAt: "2026-01-01T00:00:00.000Z", context: { sessionId: "s1", agent: "lead" } });
		appendMessagesToJsonl(
			messagesPath,
			Array.from({ length: 120 }, (_, i) => ({
				role: "user",
				content: `message ${i}`,
				ts: 1700000000000 + i,
			})),
		);

		const messages = await readPersistedMessagesFile(messagesPath);

		expect(messages).toHaveLength(120);
		// Oldest first, chronological — pagination needs the full ordered list.
		expect((messages[0] as { content: string }).content).toBe("message 0");
		expect((messages[119] as { content: string }).content).toBe("message 119");
	});

	it("honors an explicit limit (tail window) when the caller asks for it", async () => {
		const dir = await mkdtemp(join(tmpdir(), "runtime-host-support-"));
		tempDirs.push(dir);
		const messagesPath = join(dir, "messages.jsonl");
		ensureJsonlHeader(messagesPath, { updatedAt: "2026-01-01T00:00:00.000Z", context: { sessionId: "s1", agent: "lead" } });
		appendMessagesToJsonl(
			messagesPath,
			Array.from({ length: 60 }, (_, i) => ({
				role: "user",
				content: `message ${i}`,
				ts: 1700000000000 + i,
			})),
		);

		const messages = await readPersistedMessagesFile(messagesPath, { limit: 3 });

		expect(messages).toHaveLength(3);
		// Most recent rows (tail), oldest-first within the window.
		expect((messages[0] as { content: string }).content).toBe("message 57");
		expect((messages[2] as { content: string }).content).toBe("message 59");
	});
});
