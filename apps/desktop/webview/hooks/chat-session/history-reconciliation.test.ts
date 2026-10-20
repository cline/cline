import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import { canReplaceFailedTurn } from "./history-reconciliation";

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
