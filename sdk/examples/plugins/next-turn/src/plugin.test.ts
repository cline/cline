import { expect, test } from "bun:test";
import type { AgentMessage, ComposerSuggestionsState } from "@cline/shared";
import { createNextTurnPlugin, factsOf, pool, state } from "./plugin";

const msg = (parts: unknown[]): AgentMessage =>
	({ id: "m", role: "assistant", content: parts, createdAt: 0 }) as AgentMessage;

const run = (status: "completed" | "aborted" | "failed", messages: AgentMessage[] = []) =>
	({ status, messages, agentId: "a", runId: "r", iterations: 1, outputText: "", usage: {} }) as never;

const edited = msg([
	{ type: "tool-call", toolCallId: "1", toolName: "write_to_file", input: { path: "a.ts" } },
	{ type: "tool-result", toolCallId: "1", toolName: "write_to_file", output: "ok" },
]);

const errored = msg([
	{ type: "tool-result", toolCallId: "1", toolName: "write_to_file", output: "nope", isError: true },
]);

test("a successful write counts one file", () => {
	expect(factsOf([edited], run("completed"))).toEqual({
		status: "completed",
		filesEdited: 1,
		toolErrored: false,
	});
});

test("an errored write counts nothing and raises the fix row first", () => {
	const facts = factsOf([edited, errored], run("completed"));
	expect(facts.filesEdited).toBe(0);
	expect(facts.toolErrored).toBe(true);
	expect(pool(facts)[0]?.kind).toBe("fix_failure");
});

test("a stopped turn leads with resume", () => {
	expect(pool(factsOf([], run("aborted")))[0]?.kind).toBe("continue");
});

test("a completed edit offers verify, review, wrap up", () => {
	expect(pool(factsOf([edited], run("completed"))).map((r) => r.kind)).toEqual([
		"verify",
		"review_diff",
		"wrap_up",
		"next_step",
	]);
});

test("state pages three at a time and knows when there is more", () => {
	const facts = { status: "completed", filesEdited: 1, toolErrored: false } as const;
	const first = state(pool(facts), 0, "r1", facts);
	expect(first.items.length).toBe(3);
	expect(first.canRefresh).toBe(true);
	expect(first.items[0]?.id).toBe("r1:verify");
	expect(state(pool(facts), 3, "r1", facts).canRefresh).toBe(false);
});

test("skip pages forward, a stale revision is refused, use is ok", async () => {
	const published: ComposerSuggestionsState[] = [];
	let slot: { onAction: (a: unknown) => unknown } | undefined;
	const plugin = createNextTurnPlugin();
	plugin.setup?.(
		{
			registerUiSlot: (s: unknown) => void (slot = s as typeof slot),
		} as never,
		{
			ui: {
				slots: ["composer.suggestions"],
				update: (_s: string, st: ComposerSuggestionsState) => published.push(st),
			},
		} as never,
	);
	await plugin.hooks?.afterRun?.({ snapshot: {}, result: run("completed", [edited]) } as never);
	expect(published.at(-1)?.items.map((i) => i.id)).toEqual([
		"r1:verify",
		"r1:review_diff",
		"r1:wrap_up",
	]);

	expect(
		await slot?.onAction({ verb: "skip", revision: "r0", input: "composer", itemId: "r1:verify" }),
	).toEqual({ outcome: "refused", reason: "stale" });
	expect(
		await slot?.onAction({ verb: "skip", revision: "r1", input: "composer", itemId: "r1:verify" }),
	).toEqual({ outcome: "ok" });
	expect(published.at(-1)?.items.map((i) => i.id)).toEqual([
		"r1:review_diff",
		"r1:wrap_up",
		"r1:next_step",
	]);
	expect(published.at(-1)?.canRefresh).toBe(false);
	for (const revision of ["r1", "r1", "r1"])
		await slot?.onAction({ verb: "skip", revision, input: "composer", itemId: "r1:wrap_up" });
	expect(published.at(-1)?.status).toBe("empty");
});
