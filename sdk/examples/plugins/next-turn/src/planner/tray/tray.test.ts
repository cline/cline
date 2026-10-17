import { describe, expect, test } from "bun:test";
import {
	type ComposerSuggestionsAction,
	type ComposerSuggestionsState,
	clampPluginUiText,
	normalizePluginUiState,
	parsePluginUiAction,
} from "@cline/shared";
import { defaultSettings } from "../../settings/settings";
import { contractSchema, schemaErrors } from "../../test-support/schema";
import { EMPTY_BACKLOG } from "../backlog";
import {
	CUE_CODES,
	type CueCode,
	type Suggestion,
	suggestion,
} from "../candidates";
import { CORE_KINDS, GATED_KINDS, type SuggestionKind } from "../kinds";
import { NextSession } from "../session/session";
import {
	OFF_REASONS,
	type OfferedSet,
	TRAY_STATES,
	type TrayAction,
	type TrayPush,
} from "./tray";
import { toTrayActions } from "./verbs";
import { clampSlotText, dormantState, toSuggestionsState } from "./view";

const OFFER_ID = "offer_6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";

function offered(
	candidates: Suggestion[],
	overrides: Partial<OfferedSet> = {},
): OfferedSet {
	return {
		sessionId: "sess_1",
		offerId: OFFER_ID,
		setId: "0a1b2c3d",
		turnKey: "sess_1:1",
		runCount: 1,
		cueCode: "completed_edits",
		candidates,
		excluded: [],
		planner: "rules",
		revision: "r1",
		rerollsLeft: 2,
		...overrides,
	};
}

function ready(
	candidates: Suggestion[],
	overrides: Partial<OfferedSet> = {},
): TrayPush {
	const set = offered(candidates, overrides);
	return {
		sessionId: "sess_1",
		seq: 3,
		state: "ready",
		turnKey: set.turnKey,
		rerollsLeft: set.rerollsLeft,
		set,
	};
}

/** What core would store for `state`: the projection must already be that. */
function expectNormal(state: ComposerSuggestionsState): void {
	expect(normalizePluginUiState("composer.suggestions", state)).toEqual({
		ok: true,
		slot: "composer.suggestions",
		state,
	});
}

/** Projects `push` for a golden, checking core would store the result unchanged. */
function projectNormal(
	push: TrayPush,
	options?: Parameters<typeof toSuggestionsState>[1],
): ComposerSuggestionsState {
	const state = toSuggestionsState(push, options);
	expectNormal(state);
	return state;
}

const verify = suggestion(
	"verify",
	"turn",
	"Run the checks for the files the last turn changed.",
	"2 files changed this turn.",
);

describe("Next's tray state as the composer.suggestions slot", () => {
	test("every kind has its word, tone and icon, and outward and connector rows are Use only", () => {
		const rows = [...CORE_KINDS, ...GATED_KINDS].map((kind: SuggestionKind) => {
			const source = kind === "check_ci" ? "connector" : "turn";
			const [item] = projectNormal(
				ready([suggestion(kind, source, `Do the ${kind} thing now.`, "why")]),
			).items;
			return [kind, item?.label, item?.tone, item?.icon, item?.sendable];
		});
		expect(rows).toEqual([
			["fix_failure", "Fix", "repair", "fix", true],
			["continue", "Resume", "continue", "resume", true],
			["next_step", "Next step", "continue", "next", true],
			["verify", "Verify", "check", "verify", true],
			["review_diff", "Review", "look", "review", true],
			["wrap_up", "Wrap up", "finish", "wrap_up", true],
			["commit", "Commit", "finish", "commit", true],
			["check_ci", "Check CI", "check", "ci", false],
			["reply_review", "Reply", "decide", "reply", false],
			["update_issue", "Update issue", "finish", "issue", false],
			["post_update", "Post update", "finish", "announce", false],
		]);
		const failed = projectNormal(
			ready([suggestion("fix_failure", "turn", "Retry the last turn.", "x")], {
				cueCode: "failed",
			}),
		).items[0];
		expect([failed?.label, failed?.icon]).toEqual(["Retry", "retry"]);
		const plan = projectNormal(
			ready([
				suggestion("next_step", "replenish", "Plan the next tasks.", "x"),
			]),
		).items[0];
		expect([plan?.label, plan?.icon, plan?.source]).toEqual([
			"Plan",
			"plan",
			undefined,
		]);
	});

	test("every cue code reads as a short phrase in its tone", () => {
		const cues = CUE_CODES.map((cueCode: CueCode) => [
			cueCode,
			projectNormal(ready([verify], { cueCode }), {
				facts: { status: "completed", filesEdited: 2, toolErrored: false },
			}).cue,
		]);
		expect(cues).toEqual([
			["cancelled", { text: "after you stopped the turn", tone: "neutral" }],
			["failed", { text: "after the turn failed", tone: "repair" }],
			["tool_error", { text: "after a command failed", tone: "repair" }],
			["completed_edits", { text: "after 2 files changed", tone: "check" }],
			["completed_no_edits", { text: "after the last turn", tone: "neutral" }],
		]);
		expect(
			projectNormal(ready([verify]), {
				facts: { status: "completed", filesEdited: 1, toolErrored: false },
			}).cue?.text,
		).toBe("after 1 file changed");
	});

	test("each tray state has its status, with a revision even when there is no set", () => {
		const statuses = TRAY_STATES.map((state) => {
			const projected = toSuggestionsState(
				{ sessionId: "sess_1", seq: 1, state },
				{ lastRevision: OFFER_ID },
			);
			expectNormal(projected);
			return [state, projected.status, projected.revision];
		});
		expect(statuses).toEqual([
			["computing", "loading", OFFER_ID],
			["ready", "empty", OFFER_ID],
			["empty", "empty", OFFER_ID],
			["exhausted", "exhausted", OFFER_ID],
			["unavailable", "unavailable", OFFER_ID],
			["off", "hidden", OFFER_ID],
		]);
		expect(
			toSuggestionsState({ sessionId: "sess_1", seq: 0, state: "off" })
				.revision,
		).toBe("none");
		expect(
			toSuggestionsState({
				sessionId: "sess_1",
				seq: 1,
				state: "computing",
				computingFor: "reroll",
			}),
		).toEqual({
			status: "loading",
			title: "Next",
			command: "next",
			cue: { text: "finding different suggestions…", tone: "neutral" },
			revision: "none",
			items: [],
			canRefresh: false,
		});
		const unavailable = toSuggestionsState({
			sessionId: "sess_1",
			seq: 2,
			state: "unavailable",
			error: "ENOENT: /home/someone/.cline/plugins",
		});
		expect(unavailable.note).toBe("Suggestions are unavailable in this chat");
		expect(JSON.stringify(unavailable)).not.toContain("ENOENT");
	});

	test("every off reason, and an off with none, is a hidden state core keeps as it is", () => {
		const reasons = [...OFF_REASONS, undefined].map((offReason) => {
			const projected = toSuggestionsState(
				{
					sessionId: "sess_1",
					seq: 4,
					state: "off",
					...(offReason ? { offReason } : {}),
				},
				{ lastRevision: OFFER_ID },
			);
			expectNormal(projected);
			return [offReason, projected.status, projected.hiddenReason];
		});
		expect(reasons).toEqual([
			["message", "hidden", "superseded"],
			["hidden", "hidden", "user"],
			["disabled", "hidden", "disabled"],
			[undefined, "hidden", "disabled"],
		]);
	});

	test("a chat no viewer attached to yet is hidden with no reason, which core keeps as it is", () => {
		const dormant = dormantState();
		expectNormal(dormant);
		expect(dormant).toEqual({
			status: "hidden",
			title: "Next",
			command: "next",
			revision: "none",
			items: [],
			canRefresh: false,
		});
	});

	test("a chat hidden for this chat projects as hidden by the person", async () => {
		const session = new NextSession({
			sessionId: "sess_1",
			settings: defaultSettings,
			env: () => ({ tools: [] }),
			sources: () => [{ id: "turn", tier: "T0", probe: () => "present" }],
			backlog: async () => EMPTY_BACKLOG,
		});
		session.invoke({ type: "hide", scope: "chat" });
		const projected = toSuggestionsState(await session.ensureCurrent());
		expect([projected.status, projected.hiddenReason]).toEqual([
			"hidden",
			"user",
		]);
		expectNormal(projected);
	});

	test("rerolls left decide New set, and the planner's state becomes one plain note", () => {
		expect(toSuggestionsState(ready([verify])).canRefresh).toBe(true);
		expect(
			toSuggestionsState(ready([verify], { rerollsLeft: 0 })).canRefresh,
		).toBe(false);
		const notes = (
			[
				[{ status: "no_provider" }, undefined],
				[{ status: "error" }, undefined],
				[{ status: "paused", resetsAt: 1 }, undefined],
				[undefined, { resetsAt: 1 }],
				[{ status: "pending" }, undefined],
			] as const
		).map(([model, paused]) =>
			toSuggestionsState(
				ready([verify], {
					...(model ? { model: { ...model } } : {}),
					...(paused ? { paused } : {}),
				}),
			),
		);
		for (const state of notes) expectNormal(state);
		expect(notes.map((state) => state.note)).toEqual([
			"Using rules: no planner model is set",
			"Using rules: the planner is unavailable",
			"Using rules for now",
			"Using rules for now",
			undefined,
		]);
	});

	test("sources become plain labels, and only a connector's http(s) link survives", () => {
		const rows = [
			suggestion("verify", "turn", "Run the checks now.", "a"),
			suggestion("next_step", "status", "Unblock the migration.", "b"),
			suggestion("next_step", "tasks", "Do the next task: Ship it", "c"),
			suggestion("next_step", "bank", "Do the next plan step.", "d"),
			suggestion("commit", "repo", "Commit these changes now.", "e"),
			suggestion("next_step", "model", "Something the model wants.", "f"),
			suggestion("check_ci", "connector", "Check CI on the PR now.", "g", {
				url: "https://github.com/o/r/pull/7",
			}),
			suggestion("update_issue", "connector", "Update the Linear issue.", "h", {
				url: "https://linear.app/team/issue/ENG-1",
			}),
			suggestion(
				"update_issue",
				"connector",
				"Update the Jira issue now.",
				"i",
				{
					url: "https://acme.atlassian.net/browse/ENG-1",
				},
			),
			suggestion("post_update", "connector", "Post an update to Slack.", "j", {
				url: "https://acme.slack.com/archives/C1",
			}),
			suggestion("check_ci", "connector", "Check CI somewhere else.", "k", {
				url: "javascript:alert(1)",
			}),
			suggestion("check_ci", "connector", "Check CI with credentials.", "l", {
				url: "https://user:secret@ci.example.com/run/1",
			}),
		];
		const sources = rows.map(
			(row) => projectNormal(ready([row])).items[0]?.source,
		);
		expect(sources).toEqual([
			{ label: "This turn" },
			{ label: "Status Hub" },
			{ label: "Tasks" },
			{ label: "Plan" },
			{ label: "Repo" },
			undefined,
			{ label: "GitHub", url: "https://github.com/o/r/pull/7" },
			{ label: "Linear", url: "https://linear.app/team/issue/ENG-1" },
			{ label: "Jira", url: "https://acme.atlassian.net/browse/ENG-1" },
			{ label: "Slack", url: "https://acme.slack.com/archives/C1" },
			{ label: "Connector" },
			{ label: "Connector" },
		]);
	});

	test("every projection is already what core stores, a long hostname and a ragged why included", () => {
		const host = `${"a".repeat(36)}.dev`;
		expect(host).toHaveLength(40);
		const states = [
			ready([
				suggestion("check_ci", "connector", "Check CI on the PR now.", "x", {
					url: `https://${host}/pr/1`,
				}),
				suggestion(
					"verify",
					"turn",
					"Run the checks.",
					"Two files\nchanged,\t\tone   with a\u200Bzero-width space",
				),
				suggestion("commit", "repo", "Commit these changes.", "dirty"),
				suggestion("wrap_up", "turn", "A fourth row the slot cuts.", "x"),
			]),
			ready([suggestion("next_step", "model", "/clear the chat", "x")]),
			{ ...ready([]), state: "exhausted" as const, rerollsLeft: 0 },
		].map((push) => toSuggestionsState(push));
		for (const state of states) expectNormal(state);
		const [first, slashOnly, exhausted] = states;
		expect(first?.items.map((item) => item.id)).toHaveLength(3);
		expect(first?.items[0]?.source?.label).toBe(`${"a".repeat(31)}…`);
		expect(first?.items[1]?.detail).toBe(
			"Two files changed, one with azero-width space",
		);
		expect([slashOnly?.status, slashOnly?.items]).toEqual(["empty", []]);
		expect([exhausted?.status, exhausted?.canRefresh]).toEqual([
			"exhausted",
			false,
		]);
	});

	test("the local text passes give exactly what the shared clampPluginUiText gives", () => {
		const samples = [
			"plain",
			"  padded\twith a tab  ",
			"line one\nline two\r\n  line three  ",
			"\u001b]0;title\u0007 bell",
			"bidi \u202Eevil\u202C and \u2066isolate\u2069 \uFEFFbom \u2060joiner \u2064plus",
			"lone \uD800 high and \uDC00 low, pair \uD83D\uDE00 kept",
			"\u00A0/clear",
			`${"\uD83D\uDE00".repeat(30)}`,
			`${"word ".repeat(60)}`,
		];
		for (const sample of samples)
			for (const max of [1, 16, 80, 2_000])
				for (const multiline of [false, true])
					expect([
						sample,
						max,
						multiline,
						clampSlotText(sample, max, multiline),
					]).toEqual([
						sample,
						max,
						multiline,
						clampPluginUiText(sample, max, { multiline }),
					]);
	});
});

describe("the slot's verbs as Next's tray actions", () => {
	const revision = OFFER_ID;
	const verbs: [ComposerSuggestionsAction, TrayAction[]][] = [
		[{ verb: "attach", surface: "desktop" }, []],
		[{ verb: "detach" }, []],
		[{ verb: "show", input: "command" }, []],
		[
			{ verb: "exposed", revision, itemIds: ["a1", "b2"] },
			[
				{ type: "exposed", offerId: revision, candidateId: "a1" },
				{ type: "exposed", offerId: revision, candidateId: "b2" },
			],
		],
		[
			{ verb: "use", revision, itemId: "a1", input: "key", msSinceExposed: 40 },
			[
				{
					type: "use",
					candidateId: "a1",
					offerId: revision,
					input: "key",
					msSinceExposed: 40,
				},
			],
		],
		[
			{ verb: "send", revision, itemId: "a1", input: "pointer" },
			[
				{
					type: "send",
					candidateId: "a1",
					offerId: revision,
					input: "pointer",
				},
			],
		],
		[
			{ verb: "skip", revision, itemId: "a1", input: "key" },
			[{ type: "skip", candidateId: "a1", offerId: revision, input: "key" }],
		],
		[
			{ verb: "unskip", revision, itemId: "a1", input: "pointer" },
			[
				{
					type: "unskip",
					candidateId: "a1",
					offerId: revision,
					input: "pointer",
				},
			],
		],
		[
			{ verb: "refresh", revision, input: "pointer", cause: "new_set" },
			[
				{
					type: "reroll",
					offerId: revision,
					input: "pointer",
					cause: "new_set",
				},
			],
		],
		[
			{ verb: "hide", scope: "chat", input: "command" },
			[{ type: "hide", scope: "chat" }],
		],
		[
			{ verb: "hide", scope: "turn", input: "key", revision },
			[
				{
					type: "label",
					event: "ignored",
					offerId: revision,
					fields: { input: "key" },
				},
			],
		],
		[
			{ verb: "clear", revision, itemId: "a1" },
			[
				{
					type: "label",
					event: "undo_adjust",
					offerId: revision,
					fields: { candidateId: "a1" },
				},
			],
		],
		[
			{ verb: "undo", revision, itemId: "a1" },
			[
				{
					type: "label",
					event: "undo_turn",
					offerId: revision,
					fields: { candidateId: "a1" },
				},
			],
		],
		[
			{ verb: "signal", name: "key_inert", reason: "stale", revision },
			[
				{
					type: "label",
					event: "key_inert",
					offerId: revision,
					fields: { reason: "stale" },
				},
			],
		],
	];

	test("each verb core accepts maps to the actions Next's own schema accepts", () => {
		const schema = contractSchema("NextTurnTrayAction");
		for (const [action, expected] of verbs) {
			expect(parsePluginUiAction("composer.suggestions", action).ok).toBe(true);
			const actions = toTrayActions(action);
			expect([action.verb, actions]).toEqual([action.verb, expected]);
			for (const trayAction of actions ?? [])
				expect([trayAction, schemaErrors(schema, trayAction)]).toEqual([
					trayAction,
					[],
				]);
		}
	});

	test("a verb Next does not know maps to nothing", () => {
		expect(
			toTrayActions({ verb: "dance" } as unknown as ComposerSuggestionsAction),
		).toBeUndefined();
	});
});
