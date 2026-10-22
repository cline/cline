import { afterAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import type { AgentMessage, ComposerSuggestionsState } from "@cline/shared";
import { createNextTurnPlugin, factsOf, pool, state } from "./plugin";

/** A worker's revisions count on from the clock at setup, so a worker set up at 0 serves r1, r2, … */
beforeEach(() => setSystemTime(new Date(0)));
afterAll(() => setSystemTime());

const msg = (parts: unknown[]): AgentMessage =>
	({
		id: "m",
		role: "assistant",
		content: parts,
		createdAt: 0,
	}) as AgentMessage;

const user = (text: string, metadata?: Record<string, unknown>): AgentMessage =>
	({
		id: "u",
		role: "user",
		content: [{ type: "text", text }],
		createdAt: 0,
		metadata,
	}) as AgentMessage;

const said = (text: string) => msg([{ type: "text", text }]);

const run = (
	status: "completed" | "aborted" | "failed",
	messages: AgentMessage[] = [],
) =>
	({
		status,
		messages,
		agentId: "a",
		runId: "r",
		iterations: 1,
		outputText: "",
		usage: {},
	}) as never;

const edited = msg([
	{
		type: "tool-call",
		toolCallId: "1",
		toolName: "write_to_file",
		input: { path: "a.ts" },
	},
	{
		type: "tool-result",
		toolCallId: "1",
		toolName: "write_to_file",
		output: "ok",
	},
]);

const errored = msg([
	{
		type: "tool-result",
		toolCallId: "1",
		toolName: "write_to_file",
		output: "nope",
		isError: true,
	},
]);

const failedCommand = msg([
	{
		type: "tool-call",
		toolCallId: "2",
		toolName: "run_commands",
		input: { commands: ["bun test"] },
	},
	{
		type: "tool-result",
		toolCallId: "2",
		toolName: "run_commands",
		output: "exit 1",
		isError: true,
	},
]);

test("a successful write counts one file", () => {
	expect(factsOf([edited], run("completed"))).toEqual({
		status: "completed",
		filesEdited: 1,
		toolErrored: false,
	});
});

const patched = (toolCallId: string, input: unknown) =>
	msg([
		{ type: "tool-call", toolCallId, toolName: "apply_patch", input },
		{ type: "tool-result", toolCallId, toolName: "apply_patch", output: "ok" },
	]);

test("a patch counts each file it adds, updates or deletes, and a file edited twice counts once", () => {
	const facts = factsOf(
		[
			patched("p1", {
				input:
					"*** Begin Patch\n*** Update File: a.ts\n@@\n-x\n+y\n*** Add File: b.ts\n+x\n*** Delete File: c.ts\n*** End Patch",
			}),
			patched(
				"p2",
				"*** Begin Patch\n*** Update File: a.ts\n@@\n-y\n+z\n*** End Patch",
			),
			edited,
		],
		run("completed"),
	);
	expect(facts.filesEdited).toBe(3);
	expect(pool(facts)[0]?.why).toBe("3 files changed this turn.");
});

test("an errored write counts nothing and raises the fix row first", () => {
	const facts = factsOf([edited, errored], run("completed"));
	expect(facts.filesEdited).toBe(0);
	expect(facts.toolErrored).toBe(true);
	expect(pool(facts)[0]?.kind).toBe("fix_failure");
});

test("an earlier turn's edits and errors say nothing about the turn that just finished", () => {
	const askedAfterEdit = factsOf(
		[user("edit a.ts"), edited, user("what is 2+2?"), said("4")],
		run("completed"),
	);
	expect(askedAfterEdit).toEqual({
		status: "completed",
		filesEdited: 0,
		toolErrored: false,
	});
	expect(pool(askedAfterEdit).map((r) => r.kind)).toEqual([
		"wrap_up",
		"next_step",
	]);

	const thankedAfterError = factsOf(
		[user("edit a.ts"), edited, errored, user("thanks"), said("welcome")],
		run("completed"),
	);
	expect(thankedAfterError.toolErrored).toBe(false);
	expect(pool(thankedAfterError).map((r) => r.kind)).not.toContain(
		"fix_failure",
	);
});

test("a message core injects mid-run stays part of the turn", () => {
	const steered = factsOf(
		[
			user("edit a.ts"),
			edited,
			user("also explain it", { userRunSpan: 0 }),
			said("done"),
		],
		run("completed"),
	);
	expect(steered.filesEdited).toBe(1);
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
	const facts = {
		status: "completed",
		filesEdited: 1,
		toolErrored: false,
	} as const;
	const first = state(pool(facts), 0, "r1", facts);
	expect(first.items.length).toBe(3);
	expect(first.canRefresh).toBe(true);
	expect(first.items[0]?.id).toBe("r1:verify");
	expect(state(pool(facts), 3, "r1", facts).canRefresh).toBe(false);
});

type Action = { verb: string } & Record<string, unknown>;

/** One plugin worker; pass an earlier worker's `published` to stand in for core's store across a restart. */
function connect(published: (ComposerSuggestionsState | null)[] = []) {
	let slot: { onAction: (a: unknown) => unknown } | undefined;
	const plugin = createNextTurnPlugin();
	plugin.setup?.(
		{
			registerUiSlot: (s: unknown) => void (slot = s as typeof slot),
		} as never,
		{
			ui: {
				slots: ["composer.suggestions"],
				update: (_s: string, st: ComposerSuggestionsState | null) =>
					published.push(st),
			},
		} as never,
	);
	return {
		published,
		last: () => published.at(-1),
		ids: () => published.at(-1)?.items.map((i) => i.id),
		act: async (action: Action) =>
			slot?.onAction({ input: "pointer", ...action }),
		afterRun: (result: unknown) =>
			plugin.hooks?.afterRun?.({ snapshot: {}, result } as never),
	};
}

const ok = { outcome: "ok" };
const stale = { outcome: "refused", reason: "stale" };

test("skip drops the named row, unskip restores it, a stale revision is refused", async () => {
	const tray = connect();
	await tray.afterRun(run("completed", [edited]));
	expect(tray.ids()).toEqual(["r1:verify", "r1:review_diff", "r1:wrap_up"]);

	expect(
		await tray.act({ verb: "skip", revision: "r0", itemId: "r1:review_diff" }),
	).toEqual(stale);
	expect(
		await tray.act({ verb: "skip", revision: "r1", itemId: "r1:review_diff" }),
	).toEqual(ok);
	expect(tray.last()?.revision).toBe("r1");
	expect(tray.ids()).toEqual(["r1:verify", "r1:wrap_up", "r1:next_step"]);
	expect(tray.last()?.canRefresh).toBe(false);

	expect(
		await tray.act({
			verb: "unskip",
			revision: "r0",
			itemId: "r1:review_diff",
		}),
	).toEqual(stale);
	expect(
		await tray.act({
			verb: "unskip",
			revision: "r1",
			itemId: "r1:review_diff",
		}),
	).toEqual(ok);
	expect(tray.ids()).toEqual(["r1:verify", "r1:review_diff", "r1:wrap_up"]);
	expect(tray.last()?.canRefresh).toBe(true);

	for (const itemId of [
		"r1:verify",
		"r1:review_diff",
		"r1:wrap_up",
		"r1:next_step",
	])
		expect(await tray.act({ verb: "skip", revision: "r1", itemId })).toEqual(
			ok,
		);
	expect(tray.last()?.status).toBe("empty");

	await tray.afterRun(run("completed", [edited]));
	expect(tray.ids()).toEqual(["r2:verify", "r2:review_diff", "r2:wrap_up"]);
});

test("refresh serves the next set under a new revision and keeps skipped rows out", async () => {
	const tray = connect();
	await tray.afterRun(run("completed", [edited, failedCommand]));
	expect(tray.ids()).toEqual(["r1:fix_failure", "r1:verify", "r1:review_diff"]);

	await tray.act({ verb: "skip", revision: "r1", itemId: "r1:verify" });
	expect(tray.ids()).toEqual([
		"r1:fix_failure",
		"r1:review_diff",
		"r1:wrap_up",
	]);
	expect(tray.last()?.canRefresh).toBe(true);

	expect(
		await tray.act({ verb: "refresh", revision: "r1", cause: "new_set" }),
	).toEqual(ok);
	expect(tray.last()?.revision).toBe("r2");
	expect(tray.ids()).toEqual(["r2:review_diff", "r2:wrap_up", "r2:next_step"]);
	expect(tray.last()?.canRefresh).toBe(false);

	expect(
		await tray.act({ verb: "refresh", revision: "r1", cause: "more" }),
	).toEqual(stale);
});

test("Skip on the last row asks for more and drops that row, not the first", async () => {
	const tray = connect();
	await tray.afterRun(run("completed", [edited]));
	expect(tray.last()?.canRefresh).toBe(true);

	expect(
		await tray.act({ verb: "refresh", revision: "r1", cause: "more" }),
	).toEqual(ok);
	expect(tray.ids()).toEqual(["r2:verify", "r2:review_diff", "r2:next_step"]);
	expect(tray.last()?.canRefresh).toBe(false);
});

test("Undo skip restores the row after a new set, until the next turn", async () => {
	const tray = connect();
	await tray.afterRun(run("completed", [edited, failedCommand]));
	await tray.act({ verb: "skip", revision: "r1", itemId: "r1:verify" });
	await tray.act({ verb: "refresh", revision: "r1", cause: "new_set" });
	expect(tray.ids()).toEqual(["r2:review_diff", "r2:wrap_up", "r2:next_step"]);

	expect(
		await tray.act({ verb: "unskip", revision: "r1", itemId: "r1:verify" }),
	).toEqual(ok);
	expect(tray.ids()).toEqual(["r2:verify", "r2:review_diff", "r2:wrap_up"]);
	expect(
		await tray.act({ verb: "unskip", revision: "r1", itemId: "r1:verify" }),
	).toEqual(stale);

	await tray.afterRun(run("completed", [edited, failedCommand]));
	await tray.act({ verb: "skip", revision: "r3", itemId: "r3:fix_failure" });
	await tray.act({ verb: "refresh", revision: "r3", cause: "new_set" });
	expect(tray.ids()).toEqual(["r4:review_diff", "r4:wrap_up", "r4:next_step"]);
	expect(
		await tray.act({
			verb: "unskip",
			revision: "r3",
			itemId: "r3:fix_failure",
		}),
	).toEqual(ok);
	expect(tray.ids()).toEqual(["r4:fix_failure", "r4:verify", "r4:review_diff"]);

	await tray.act({ verb: "skip", revision: "r4", itemId: "r4:verify" });
	await tray.afterRun(run("completed", [edited, failedCommand]));
	expect(
		await tray.act({ verb: "unskip", revision: "r4", itemId: "r4:verify" }),
	).toEqual(stale);
	expect(tray.ids()).toEqual(["r5:fix_failure", "r5:verify", "r5:review_diff"]);
});

test("once it has served a set, use and send are ok only for a row the current set still offers", async () => {
	const tray = connect();
	await tray.afterRun(run("completed", [edited]));
	expect(
		await tray.act({ verb: "use", revision: "r1", itemId: "r1:verify" }),
	).toEqual(ok);
	expect(
		await tray.act({ verb: "send", revision: "r1", itemId: "r1:verify" }),
	).toEqual(ok);
	expect(
		await tray.act({ verb: "send", revision: "r1", itemId: "r1:next_step" }),
	).toEqual(stale);
	expect(
		await tray.act({ verb: "send", revision: "r0", itemId: "r1:verify" }),
	).toEqual(stale);

	await tray.act({ verb: "skip", revision: "r1", itemId: "r1:verify" });
	expect(
		await tray.act({ verb: "send", revision: "r1", itemId: "r1:verify" }),
	).toEqual(stale);
	expect(
		await tray.act({ verb: "send", revision: "r1", itemId: "r1:next_step" }),
	).toEqual(ok);

	await tray.afterRun(run("failed"));
	expect(
		await tray.act({ verb: "use", revision: "r1", itemId: "r1:review_diff" }),
	).toEqual(stale);
	expect(
		await tray.act({ verb: "send", revision: "r1", itemId: "r1:review_diff" }),
	).toEqual(stale);
	expect(
		await tray.act({
			verb: "send",
			revision: tray.last()?.revision,
			itemId: tray.ids()?.[0],
		}),
	).toEqual(ok);
});

test("hide for this chat holds across turns until show", async () => {
	const tray = connect();
	await tray.afterRun(run("completed", [edited]));
	const shown = tray.published.length;

	expect(await tray.act({ verb: "hide", scope: "turn" })).toEqual(ok);
	expect(tray.published.length).toBe(shown);

	expect(
		await tray.act({ verb: "hide", scope: "chat", revision: "r1" }),
	).toEqual(ok);
	expect(tray.last()).toEqual({
		status: "hidden",
		hiddenReason: "user",
		title: "Next",
		command: "next",
		revision: "r1",
		items: [],
		canRefresh: false,
	});
	expect(
		await tray.act({ verb: "send", revision: "r1", itemId: "r1:verify" }),
	).toEqual(stale);

	await tray.afterRun(run("completed", [edited]));
	expect(tray.last()).toMatchObject({
		status: "hidden",
		hiddenReason: "user",
		revision: "r2",
	});

	expect(await tray.act({ verb: "show" })).toEqual(ok);
	expect(tray.last()?.status).toBe("ready");
	expect(tray.ids()).toEqual(["r2:verify", "r2:review_diff", "r2:wrap_up"]);
});

test("a worker restarted after an idle reclaim withdraws the set core still holds, lets the click on it use or send, and never reissues its revision", async () => {
	const before = connect();
	expect(before.last()).toBeNull();
	await before.afterRun(run("completed", [edited]));
	expect(before.ids()).toEqual(["r1:verify", "r1:review_diff", "r1:wrap_up"]);

	setSystemTime(new Date(30 * 60_000));
	const after = connect(before.published);
	expect(after.last()).toBeNull();
	const verify = { revision: "r1", itemId: "r1:verify" };
	expect(await after.act({ verb: "use", ...verify })).toEqual(ok);
	expect(await after.act({ verb: "send", ...verify })).toEqual(ok);
	expect(await after.act({ verb: "skip", ...verify })).toEqual(stale);
	expect(
		await after.act({ verb: "refresh", revision: "r1", cause: "new_set" }),
	).toEqual(stale);
	expect(after.last()).toBeNull();
	await after.afterRun(run("completed", [edited]));
	expect(after.last()?.revision).not.toBe("r1");
	expect(after.ids()).toEqual([
		"r1800001:verify",
		"r1800001:review_diff",
		"r1800001:wrap_up",
	]);
});

test("setup pushes nothing to a host that renders no slot", () => {
	const updates: unknown[] = [];
	const plugin = createNextTurnPlugin();
	plugin.setup?.(
		{ registerUiSlot: () => {} } as never,
		{
			ui: { slots: [], update: (...args: unknown[]) => updates.push(args) },
		} as never,
	);
	expect(updates).toEqual([]);
});
