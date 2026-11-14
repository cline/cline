import { cloudSessionToDiscoveryRecord } from "@cline/core/cloud";
import { describe, expect, it, vi } from "vitest";

vi.mock("@cline/core", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cline/core")>()),
	SqliteSessionStore: class {
		get() {
			return { metadata: {} };
		}
	},
}));
vi.mock("../paths", () => ({
	sharedSessionDataDir: () => "/nonexistent-cline-discovery-test",
	readSessionManifest: () => undefined,
}));
vi.mock("./messages", () => ({ readPersistedChatMessages: () => [] }));

import { discoverChatSessions, mergeDiscoveredSessionLists } from "./discovery";

describe("desktop session discovery", () => {
	it.each([
		undefined,
		"2026-07-20T11:00:00Z",
	])("keeps cloud metadata updates out of activity ordering (%s)", (lastActivityAt) => {
		const cloud = {
			...cloudSessionToDiscoveryRecord({
				id: "ses-idle",
				status: "ready",
				sandboxUrl: "",
				repoContext: {},
				metadata: { modelId: "model" },
				createdAt: "2026-07-20T10:00:00Z",
				lastActivityAt,
				updatedAt: "2026-07-20T16:00:00Z",
			}),
			endedAt: "2026-07-20T16:00:00Z",
		};
		const local = {
			sessionId: "local-recent",
			startedAt: "2026-07-20T14:00:00Z",
			endedAt: "2026-07-20T15:00:00Z",
		};
		expect(mergeDiscoveredSessionLists([local], [cloud], 1)).toMatchObject([
			{ sessionId: "local-recent" },
		]);
		expect(
			mergeDiscoveredSessionLists(
				[local],
				[{ ...cloud, lastActivityAt: "2026-07-20T16:00:00Z" }],
				1,
			),
		).toMatchObject([{ sessionId: "ses-idle" }]);
	});
	it.each([
		"idle",
		"running",
		"pending",
		"completed",
	])("hides promptless %s sessions with recovery messages", (status) => {
		expect(
			discoverChatSessions({
				liveSessions: new Map([
					[
						"empty",
						{
							busy: status === "running",
							status,
							startedAt: 1,
							config: {},
							messages: [
								{
									role: "user",
									content: "Recovered",
									metadata: { kind: "recovery_notice" },
								},
							],
						},
					],
				]),
			}),
		).toEqual([]);
	});
	it("keeps a first prompt before messages arrive", () => {
		expect(
			discoverChatSessions({
				liveSessions: new Map([
					[
						"started",
						{
							busy: true,
							status: "running",
							startedAt: 1,
							config: {},
							prompt: "Hello",
							messages: [],
						},
					],
				]),
			}),
		).toMatchObject([{ sessionId: "started", prompt: "Hello" }]);
	});
	it("recovers a prompt from history", () => {
		expect(
			discoverChatSessions({
				liveSessions: new Map([
					[
						"history",
						{
							busy: false,
							status: "completed",
							startedAt: 1,
							config: {},
							prompt: " ",
							messages: [{ role: "user", content: "Hello" }],
						},
					],
				]),
			}),
		).toMatchObject([{ sessionId: "history", prompt: "Hello" }]);
	});
});

// These are the same prompt derivation rules used by restore and fork.
import { derivePromptFromMessages } from "./common";

describe("restored session prompts", () => {
	it.each([
		"recovery_notice",
		"compaction",
		"compaction_summary",
		"completion_reminder",
		"manual_compaction",
	])("ignores %s text", (kind) => {
		const messages = [
			{ role: "user", content: "Synthetic text", metadata: { kind } },
		];
		expect(derivePromptFromMessages(messages)).toBeUndefined();
		expect(
			derivePromptFromMessages([
				...messages,
				{ role: "user", content: "Actual question" },
			]),
		).toBe("Actual question");
	});
	it.each([
		"image",
		"file",
	])("keeps idle attachment-only %s sessions", (type) => {
		const messages = [
			{ role: "user", content: [{ type, data: "attachment" }] },
		];
		expect(
			discoverChatSessions({
				liveSessions: new Map([
					[
						"attachment",
						{
							busy: false,
							status: "idle",
							startedAt: 1,
							config: {},
							prompt: "",
							messages,
						},
					],
				]),
			}),
		).toMatchObject([{ sessionId: "attachment", prompt: `[${type}]` }]);
	});
});
