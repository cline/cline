/**
 * The run-outcome card's aggregation. The invariant that matters: the card is
 * derived from the SAME parsed diffs the tool cards render, scoped to the
 * blocks after the last user message — so it can never disagree with the
 * transcript, and an earlier run's edits never leak into this run's card.
 */

import { describe, expect, it } from "vitest";
import type { SessionMessageView } from "@/session";
import { formatRunDuration, summarizeLastRun } from "./run-summary";

function message(
	role: "user" | "assistant",
	blocks: SessionMessageView["blocks"],
	id = `${role}-${Math.random().toString(36).slice(2, 8)}`,
): SessionMessageView {
	return { id, role, blocks, origin: "live" };
}

function editTool(
	path: string,
	newText: string,
	state: "completed" | "failed" = "completed",
): SessionMessageView["blocks"][number] {
	return {
		kind: "tool",
		toolCallId: `tc-${path}`,
		name: "edit_file",
		state,
		input: { path, old_text: "", new_text: newText },
	};
}

describe("summarizeLastRun", () => {
	it("aggregates files and totals from the blocks after the last user message", () => {
		const summary = summarizeLastRun([
			message("user", [{ kind: "text", text: "earlier" }]),
			message("assistant", [editTool("stale.ts", "old run edit")]),
			message("user", [{ kind: "text", text: "do the thing" }]),
			message("assistant", [
				editTool("a.ts", "one\ntwo"),
				editTool("b.ts", "three"),
				{
					kind: "tool",
					toolCallId: "tc-run",
					name: "run_command",
					state: "completed",
					input: { command: "bun test" },
				},
			]),
		]);
		expect(summary).toBeDefined();
		expect(summary?.toolCount).toBe(3);
		expect(summary?.files.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);
		expect(summary?.additions).toBe(3);
		// The earlier run's edit must not appear.
		expect(summary?.files.some((file) => file.path === "stale.ts")).toBe(false);
	});

	it("counts failed tool calls", () => {
		const summary = summarizeLastRun([
			message("user", [{ kind: "text", text: "go" }]),
			message("assistant", [editTool("a.ts", "x", "failed")]),
		]);
		expect(summary?.failedCount).toBe(1);
		expect(summary?.files).toEqual([]);
		expect(summary?.additions).toBe(0);
		expect(summary?.deletions).toBe(0);
	});

	it("summarizes to nothing when the run used no tools", () => {
		expect(
			summarizeLastRun([
				message("user", [{ kind: "text", text: "hi" }]),
				message("assistant", [{ kind: "text", text: "hello" }]),
			]),
		).toBeUndefined();
	});

	it("merges repeated edits to one file", () => {
		const summary = summarizeLastRun([
			message("user", [{ kind: "text", text: "go" }]),
			message("assistant", [
				editTool("a.ts", "one"),
				editTool("a.ts", "two\nthree"),
			]),
		]);
		expect(summary?.files).toEqual([
			{ path: "a.ts", additions: 3, deletions: 0 },
		]);
	});
});

describe("formatRunDuration", () => {
	it("formats seconds and minutes", () => {
		expect(formatRunDuration(0, 45_000)).toBe("45s");
		expect(formatRunDuration(0, 134_000)).toBe("2m 14s");
	});

	it("returns nothing when either endpoint is missing or reversed", () => {
		expect(formatRunDuration(undefined, 1)).toBeUndefined();
		expect(formatRunDuration(1, undefined)).toBeUndefined();
		expect(formatRunDuration(5, 1)).toBeUndefined();
	});
});

describe("confirmed approval outcomes in summaries", () => {
	it.each([
		"denied",
		"expired",
		"cancelled",
	] as const)("keeps %s distinct from execution failure", (approvalStatus) => {
		const summary = summarizeLastRun([
			message("user", [{ kind: "text", text: "go" }]),
			message("assistant", [
				{
					kind: "tool",
					toolCallId: "blocked",
					name: "edit_file",
					state: "failed",
					input: { path: "blocked.ts", new_text: "never applied" },
					approvalStatus,
				},
				{
					kind: "tool",
					toolCallId: "failed",
					name: "bash",
					state: "failed",
					error: "process failed",
				},
			]),
		]);
		expect(summary?.failedCount).toBe(1);
		expect(summary?.[`${approvalStatus}Count`]).toBe(1);
		expect(summary?.files).toEqual([]);
	});
	it("does not infer denial from an uncorrelated error message", () => {
		const summary = summarizeLastRun([
			message("assistant", [
				{
					kind: "tool",
					toolCallId: "unknown",
					name: "bash",
					state: "failed",
					error: "Denied",
				},
			]),
		]);
		expect(summary?.failedCount).toBe(1);
		expect(summary?.deniedCount).toBeUndefined();
	});
});
