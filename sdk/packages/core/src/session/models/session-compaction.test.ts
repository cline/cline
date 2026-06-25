import { describe, expect, it } from "vitest";
import {
	createSessionCompactionState,
	parseSessionCompactionState,
	projectSessionCompactionState,
} from "./session-compaction";

describe("session compaction state", () => {
	it("rejects projection when the canonical prefix was edited before the boundary", () => {
		const sourceMessages = [
			{ id: "u1", role: "user" as const, content: "original detail" },
			{ id: "a1", role: "assistant" as const, content: "answer" },
		];
		const state = createSessionCompactionState({
			sourceMessages,
			compactedMessages: [
				{ id: "summary", role: "user" as const, content: "summary" },
			],
			updatedAt: "2026-01-01T00:00:00.000Z",
		});

		const editedPrefix = [
			{ ...sourceMessages[0], content: "redacted detail" },
			sourceMessages[1],
			{ id: "u2", role: "user" as const, content: "tail" },
		];

		expect(projectSessionCompactionState(state, editedPrefix)).toBeUndefined();
	});

	it("projects compacted state when the canonical prefix matches exactly", () => {
		const sourceMessages = [
			{ id: "u1", role: "user" as const, content: "original detail" },
			{ id: "a1", role: "assistant" as const, content: "answer" },
		];
		const compactedMessages = [
			{ id: "summary", role: "user" as const, content: "summary" },
		];
		const tail = { id: "u2", role: "user" as const, content: "tail" };
		const state = createSessionCompactionState({
			sourceMessages,
			compactedMessages,
			updatedAt: "2026-01-01T00:00:00.000Z",
		});

		expect(
			projectSessionCompactionState(state, [...sourceMessages, tail]),
		).toEqual([...compactedMessages, tail]);
	});

	it("projects when resumed user input was display-normalized from persisted history", () => {
		const sourceMessages = [
			{
				id: "u1",
				role: "user" as const,
				content: '<user_input mode="act">hello</user_input>',
			},
			{
				id: "u2",
				role: "user" as const,
				content: [
					{
						type: "text" as const,
						text: '<user_input mode="act">inspect</user_input>',
					},
				],
			},
			{ id: "a1", role: "assistant" as const, content: "answer" },
		];
		const resumedMessages = [
			{ ...sourceMessages[0], content: "hello" },
			{
				...sourceMessages[1],
				content: [{ type: "text" as const, text: "inspect" }],
			},
			sourceMessages[2],
			{ id: "u3", role: "user" as const, content: "tail" },
		];
		const compactedMessages = [
			{ id: "summary", role: "user" as const, content: "summary" },
		];
		const state = createSessionCompactionState({
			sourceMessages,
			compactedMessages,
			updatedAt: "2026-01-01T00:00:00.000Z",
		});

		expect(projectSessionCompactionState(state, resumedMessages)).toEqual([
			...compactedMessages,
			resumedMessages[3],
		]);
	});

	it("rejects anchor-free sidecars even when the source count is zero", () => {
		const state = parseSessionCompactionState({
			version: 1,
			updated_at: "2026-01-01T00:00:00.000Z",
			source_message_count: 0,
			messages: [
				{ id: "summary", role: "user" as const, content: "unanchored" },
			],
		});

		expect(state).toBeDefined();
		if (!state) {
			throw new Error("expected parsed compaction state");
		}
		expect(
			projectSessionCompactionState(state, [
				{ id: "u1", role: "user", content: "canonical" },
			]),
		).toBeUndefined();
	});

	it("projects legacy sidecars when the boundary key matches", () => {
		const sourceMessages = [
			{ id: "u1", role: "user" as const, content: "original detail" },
			{ id: "a1", role: "assistant" as const, content: "answer" },
		];
		const tail = { id: "u2", role: "user" as const, content: "tail" };
		const state = parseSessionCompactionState({
			version: 1,
			updated_at: "2026-01-01T00:00:00.000Z",
			source_message_count: sourceMessages.length,
			source_last_message_key: "id:a1",
			messages: [{ id: "summary", role: "user" as const, content: "summary" }],
		});

		expect(state).toBeDefined();
		if (!state) {
			throw new Error("expected parsed compaction state");
		}
		expect(
			projectSessionCompactionState(state, [...sourceMessages, tail]),
		).toEqual([{ id: "summary", role: "user", content: "summary" }, tail]);
	});

	it("rejects malformed sidecar timestamps", () => {
		const state = parseSessionCompactionState({
			version: 1,
			updated_at: "not-a-date",
			source_message_count: 1,
			source_prefix_hash: "sha256:test",
			messages: [{ id: "summary", role: "user" as const, content: "summary" }],
		});

		expect(state).toBeUndefined();
	});
});
