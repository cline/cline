import { describe, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import { createSidecarContext } from "./context";
import {
	parseNextTurnSuggestionsReply,
	readNextTurnSuggestions,
} from "./plugin-commands";
import { LOCAL_ENVIRONMENT_ID, type SessionRuntimeBinding } from "./types";

describe("parseNextTurnSuggestionsReply", () => {
	it("returns up to three trimmed prompts in their original order", () => {
		expect(
			parseNextTurnSuggestionsReply(
				JSON.stringify({ v: 1, suggestions: [" first ", "second", "third"] }),
			),
		).toEqual(["first", "second", "third"]);
	});

	it.each([
		undefined,
		"not json",
		"null",
		JSON.stringify({ v: 2, suggestions: ["first"] }),
		JSON.stringify({ v: 1, suggestions: "first" }),
		JSON.stringify({ v: 1, suggestions: ["first", ""] }),
		JSON.stringify({ v: 1, suggestions: ["a", "b", "c", "d"] }),
		JSON.stringify({ v: 1, suggestions: ["x".repeat(2_001)] }),
	])("rejects malformed input %s", (reply) => {
		expect(parseNextTurnSuggestionsReply(reply)).toEqual([]);
	});
});

describe("next_turn_suggestions", () => {
	function contextWithReply(reply: string | undefined, error?: Error) {
		const ctx = createSidecarContext("/fallback-workspace");
		const command = error
			? vi.fn().mockRejectedValue(error)
			: vi.fn().mockResolvedValue({
					ok: true,
					payload: { result: reply ? { reply } : undefined },
				});
		ctx.runtimeBindings.set(LOCAL_ENVIRONMENT_ID, {
			hubClient: { command },
		} as unknown as SessionRuntimeBinding);
		ctx.liveSessions.set("session-1", {
			environmentId: LOCAL_ENVIRONMENT_ID,
			config: { workspaceRoot: "/session-workspace" },
		} as never);
		return { ctx, command };
	}

	it("invokes only the structured next command and returns its suggestions", async () => {
		const { ctx, command } = contextWithReply(
			JSON.stringify({ v: 1, suggestions: ["verify", "review"] }),
		);

		await expect(
			handleCommand(ctx, "next_turn_suggestions", {
				workspacePath: "/fallback-workspace",
				sessionId: "session-1",
				environmentId: LOCAL_ENVIRONMENT_ID,
			}),
		).resolves.toEqual(["verify", "review"]);
		expect(command).toHaveBeenCalledWith(
			"plugins.commands.run",
			{
				workspacePath: "/session-workspace",
				sessionId: "session-1",
				prompt: "/next --format=json",
			},
			"session-1",
			{ timeoutMs: null, retryAfterDispatch: false },
		);
	});

	it("returns no suggestions when the command is missing or fails", async () => {
		const missing = contextWithReply(undefined);
		expect(
			await readNextTurnSuggestions(missing.ctx, {
				workspacePath: "/fallback-workspace",
				sessionId: "session-1",
			}),
		).toEqual([]);

		const failed = contextWithReply(undefined, new Error("hub unavailable"));
		expect(
			await readNextTurnSuggestions(failed.ctx, {
				workspacePath: "/fallback-workspace",
				sessionId: "session-1",
			}),
		).toEqual([]);
	});
});
