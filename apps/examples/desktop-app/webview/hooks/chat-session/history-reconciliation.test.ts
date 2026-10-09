import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import {
	canReplaceFailedTurn,
	withLivePluginIssues,
} from "./history-reconciliation";

const row = (
	id: string,
	role: ChatMessage["role"],
	runCount?: number,
): ChatMessage => ({
	id,
	role,
	sessionId: "s",
	content: "same text",
	createdAt: 1,
	meta: runCount ? { runCount } : undefined,
});

describe("failed turn history reconciliation", () => {
	it("rejects an earlier error while a repeated prompt has a new live failure", () => {
		const old = [row("u1", "user", 4), row("e1", "error", 4)];
		const current = [
			...old,
			row("u2", "user"),
			row("partial", "assistant"),
			row("tool", "tool"),
			row("live", "error"),
		];
		expect(canReplaceFailedTurn(current, old)).toBe(false);
		expect(canReplaceFailedTurn(current, [...old, row("u2", "user", 5)])).toBe(
			false,
		);
		expect(
			canReplaceFailedTurn(current, [
				...old,
				row("u2", "user", 5),
				row("e2", "error", 5),
			]),
		).toBe(true);
	});
	it("rejects an earlier error ID even for a continuation in the same user run", () => {
		const old = [row("u1", "user"), row("e1", "error")];
		expect(canReplaceFailedTurn([...old, row("live", "error")], old)).toBe(
			false,
		);
	});
});

describe("withLivePluginIssues", () => {
	const message = (
		id: string,
		createdAt: number,
		extra: Partial<ChatMessage> = {},
	): ChatMessage => ({
		id,
		sessionId: "s1",
		role: "assistant",
		content: id,
		createdAt,
		...extra,
	});
	const warning = (id: string, createdAt: number) =>
		message(id, createdAt, {
			role: "status",
			meta: { messageKind: "plugin_issue" },
		});

	it("keeps live plugin warnings in their place when history replaces the transcript", () => {
		const history = [
			message("user-1", 10, { role: "user" }),
			message("answer-1", 30),
		];
		const merged = withLivePluginIssues(
			[
				warning("start-warning", 5),
				message("streamed", 20),
				warning("notice", 25),
			],
			history,
		);
		expect(merged.map((item) => item.id)).toEqual([
			"start-warning",
			"user-1",
			"notice",
			"answer-1",
		]);
	});

	it("returns history unchanged when there are no live warnings", () => {
		const history = [message("answer-1", 30)];
		expect(withLivePluginIssues([message("streamed", 20)], history)).toBe(
			history,
		);
	});
});
