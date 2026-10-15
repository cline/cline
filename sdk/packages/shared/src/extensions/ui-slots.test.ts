import { describe, expect, it } from "vitest";
import { sanitizeSurrogates } from "../llms/ai-sdk-format";
import {
	applyPluginUiState,
	type ComposerSuggestionItem,
	type ComposerSuggestionsState,
	clampPluginUiText,
	comparePluginUiOrder,
	isPluginUiStateEnvelope,
	normalizePluginUiState,
	PLUGIN_UI_LIMITS,
	type PluginUiStateEnvelope,
	parsePluginUiAction,
	readPluginUiEnvelope,
	readPluginUiSlotCatalog,
} from "./ui-slots";
import { PLUGIN_UI_FIXTURES } from "./ui-slots.fixtures";

const SLOT = "composer.suggestions";
const { readyOne, readyThree } = PLUGIN_UI_FIXTURES.composerSuggestions;
const FOUR_BYTE = String.fromCodePoint(0x1f600);
const LONE_HIGH = String.fromCharCode(0xd800);
const LONE_LOW = String.fromCharCode(0xdc00);

function item(
	id: string,
	overrides: Partial<ComposerSuggestionItem> = {},
): ComposerSuggestionItem {
	return {
		id,
		label: "Verify",
		tone: "check",
		prompt: `Run check ${id}`,
		sendable: true,
		...overrides,
	};
}

function ready(items: unknown[]): Record<string, unknown> {
	return { ...readyOne, items };
}

function keptState(value: unknown): ComposerSuggestionsState {
	const result = normalizePluginUiState(SLOT, value);
	if (!result.ok || !result.state)
		throw new Error(`expected a kept state, got ${JSON.stringify(result)}`);
	return result.state;
}

function keptItem(
	raw: Partial<ComposerSuggestionItem>,
): ComposerSuggestionItem {
	return keptState(ready([{ ...item("a"), ...raw }])).items[0];
}

function utf8Bytes(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

describe("normalizePluginUiState", () => {
	it.each(
		Object.entries(PLUGIN_UI_FIXTURES.composerSuggestions),
	)("keeps the golden %s state unchanged", (_name, state) => {
		expect(normalizePluginUiState(SLOT, state)).toEqual({
			ok: true,
			slot: SLOT,
			state,
		});
	});

	it.each(
		PLUGIN_UI_FIXTURES.hostile.map((fixture) => [fixture.name, fixture]),
	)("handles %s", (_name, fixture) => {
		expect(normalizePluginUiState(fixture.slot, fixture.value)).toEqual(
			fixture.expected,
		);
	});

	it("clears the slot on null", () => {
		expect(normalizePluginUiState(SLOT, null)).toEqual({
			ok: true,
			slot: SLOT,
			state: null,
		});
	});

	it("is idempotent", () => {
		const outputs = [
			...Object.values(PLUGIN_UI_FIXTURES.composerSuggestions),
			...PLUGIN_UI_FIXTURES.hostile.flatMap((fixture) =>
				fixture.expected.ok && fixture.expected.state
					? [fixture.expected.state]
					: [],
			),
			keptState(
				ready([
					item("a", {
						prompt: "\n  Fix\tthe build\n\nthen rerun  \n",
						detail: ` why ${"x".repeat(400)} `,
						source: { label: "Docs", url: " https://example.com/a b " },
					}),
				]),
			),
		];
		for (const state of outputs) {
			expect(keptState(state)).toEqual(state);
		}
	});

	describe("size", () => {
		it("clamps three long prompts of 4-byte characters and keeps the state", () => {
			const prompt = FOUR_BYTE.repeat(2_500);
			const state = keptState(
				ready([
					item("a", { prompt }),
					item("b", { prompt }),
					item("c", { prompt }),
				]),
			);

			expect(state.items).toHaveLength(3);
			for (const kept of state.items) {
				expect(Array.from(kept.prompt)).toHaveLength(
					PLUGIN_UI_LIMITS.promptChars,
				);
				expect(kept.prompt.endsWith("…")).toBe(true);
			}
			expect(utf8Bytes(state)).toBeLessThanOrEqual(PLUGIN_UI_LIMITS.stateBytes);
		});

		it("keeps a state with every field at its clamp", () => {
			const text = (chars: number) => FOUR_BYTE.repeat(chars);
			const url = (n: number) =>
				`https://example.com/${n}${"a".repeat(PLUGIN_UI_LIMITS.urlChars - 21)}`;
			const atClamp = (n: number): ComposerSuggestionItem => ({
				id: `${n}`.repeat(64),
				label: text(PLUGIN_UI_LIMITS.labelChars),
				tone: "check",
				icon: "verify",
				prompt: text(PLUGIN_UI_LIMITS.promptChars),
				detail: text(PLUGIN_UI_LIMITS.detailChars),
				source: { label: text(PLUGIN_UI_LIMITS.sourceLabelChars), url: url(n) },
				sendable: true,
			});
			const state: ComposerSuggestionsState = {
				status: "ready",
				title: text(PLUGIN_UI_LIMITS.titleChars),
				command: "a".repeat(16),
				cue: { text: text(PLUGIN_UI_LIMITS.cueChars), tone: "repair" },
				note: text(PLUGIN_UI_LIMITS.noteChars),
				revision: "r".repeat(64),
				items: [atClamp(1), atClamp(2), atClamp(3)],
				canRefresh: true,
			};
			expect(state.items[0].source?.url).toHaveLength(
				PLUGIN_UI_LIMITS.urlChars,
			);

			expect(keptState(state)).toEqual(state);
			expect(utf8Bytes(state)).toBeLessThanOrEqual(PLUGIN_UI_LIMITS.stateBytes);
		});

		it("drops a raw value over 64 KiB before parsing it", () => {
			expect(
				normalizePluginUiState(SLOT, {
					junk: "x".repeat(PLUGIN_UI_LIMITS.workerStateBytes + 1),
				}),
			).toEqual({ ok: false, reason: "too_large" });
		});

		it("drops a state still over the state budget after clamping", () => {
			// The clamped worst case fits the real budget, so this lowers it to reach the check.
			const limits = PLUGIN_UI_LIMITS as { stateBytes: number };
			const stateBytes = limits.stateBytes;
			limits.stateBytes = 1_024;
			try {
				expect(
					normalizePluginUiState(
						SLOT,
						ready([
							item("a", { prompt: "x".repeat(PLUGIN_UI_LIMITS.promptChars) }),
						]),
					),
				).toEqual({ ok: false, reason: "too_large" });
			} finally {
				limits.stateBytes = stateBytes;
			}
		});
	});

	describe("text", () => {
		it("turns a tab in a prompt into a space", () => {
			expect(keptItem({ prompt: "Run\ttests" }).prompt).toBe("Run tests");
		});

		it("keeps a newline in a prompt and folds it in a detail", () => {
			const kept = keptItem({
				prompt: "Fix it\nthen test",
				detail: "one\ntwo",
			});
			expect(kept.prompt).toBe("Fix it\nthen test");
			expect(kept.detail).toBe("one two");
		});

		it("strips the word joiner and U+2064", () => {
			expect(keptItem({ label: "Ve\u2060ri\u2064fy" }).label).toBe("Verify");
		});

		it("replaces a lone surrogate with U+FFFD so its size is never a 6-byte escape", () => {
			const state = keptState(ready([item("a", { prompt: `a${LONE_HIGH}b` })]));

			expect(state.items[0].prompt).toBe("a\uFFFDb");
			expect(JSON.stringify(state)).not.toContain("\\ud800");
		});

		it("writes lone high and low surrogates exactly as sanitizeSurrogates does", () => {
			const prompt = `high ${LONE_HIGH} low ${LONE_LOW} pair ${FOUR_BYTE}`;
			expect(keptItem({ prompt }).prompt).toBe(sanitizeSurrogates(prompt));
		});

		it("drops prompts that hide a slash command behind whitespace or a BOM", () => {
			const hidden = [
				" /clear",
				"\n/clear",
				"\u00A0/clear",
				"\u3000/clear",
				"\uFEFF/clear",
			];
			const state = keptState(
				ready([
					...hidden.map((prompt, index) => item(`hidden-${index}`, { prompt })),
					item("kept"),
				]),
			);

			expect(state.items.map((kept) => kept.id)).toEqual(["kept"]);
		});

		it("trims blank lines around a prompt and keeps its interior newline", () => {
			expect(keptItem({ prompt: "\n\n  Fix it\nthen test  \n\n" }).prompt).toBe(
				"Fix it\nthen test",
			);
		});
	});

	describe("items", () => {
		it("turns a ready state whose every item is dropped into empty", () => {
			const state = keptState(
				ready([item("a", { label: " " }), item("b", { prompt: "/undo" })]),
			);

			expect(state).toEqual({ ...readyOne, status: "empty", items: [] });
		});

		it("keeps only the first item for a repeated id", () => {
			const state = keptState(
				ready([item("a", { label: "First" }), item("a", { label: "Second" })]),
			);

			expect(state.items).toEqual([item("a", { label: "First" })]);
		});

		it("keeps valid items behind invalid leading ones", () => {
			const state = keptState(
				ready([
					item("a", { label: "" }),
					item("b", { prompt: "/clear" }),
					item("not a token"),
					item("d"),
					item("e"),
				]),
			);

			expect(state.items.map((kept) => kept.id)).toEqual(["d", "e"]);
		});

		it("never reads an eleventh raw item", () => {
			const invalid = Array.from(
				{ length: PLUGIN_UI_LIMITS.rawItems },
				(_, index) => item(`bad-${index}`, { prompt: "/clear" }),
			);
			const state = keptState(ready([...invalid, item("eleventh")]));

			expect(state.status).toBe("empty");
			expect(state.items).toEqual([]);
		});

		it("cuts four valid items to the first three after the filters", () => {
			const state = keptState(
				ready([item("a"), item("b"), item("c"), item("d")]),
			);

			expect(state.items.map((kept) => kept.id)).toEqual(["a", "b", "c"]);
		});
	});

	describe("hiddenReason and revision", () => {
		it("removes an unknown hiddenReason and stays hidden", () => {
			const state = keptState({
				...PLUGIN_UI_FIXTURES.composerSuggestions.hidden,
				hiddenReason: "later",
			});

			expect(state).toEqual(PLUGIN_UI_FIXTURES.composerSuggestions.hidden);
		});

		it("removes a hiddenReason from a status other than hidden", () => {
			expect(keptState({ ...readyOne, hiddenReason: "user" })).toEqual(
				readyOne,
			);
		});

		it("drops a hidden state without a revision", () => {
			const { revision: _revision, ...withoutRevision } =
				PLUGIN_UI_FIXTURES.composerSuggestions.hidden;

			expect(normalizePluginUiState(SLOT, withoutRevision)).toEqual({
				ok: false,
				reason: "invalid",
			});
		});
	});

	describe("source urls", () => {
		it("stores the parsed href of a url with surrounding and inner spaces", () => {
			expect(
				keptItem({
					source: { label: "Docs", url: " https://example.com/a b " },
				}).source,
			).toEqual({ label: "Docs", url: "https://example.com/a%20b" });
		});

		it("removes a url whose href passes the limit only after percent-encoding", () => {
			const url = `https://example.com/x${" ".repeat(1_000)}y`;
			expect(url.length).toBeLessThanOrEqual(PLUGIN_UI_LIMITS.urlChars);

			expect(keptItem({ source: { label: "Docs", url } }).source).toEqual({
				label: "Docs",
			});
		});

		it("leaves a stored href unchanged", () => {
			const source = {
				label: "Docs",
				url: "https://example.com/a%20b?q=1#top",
			};
			expect(keptItem({ source }).source).toEqual(source);
		});
	});
});

describe("clampPluginUiText", () => {
	it("gives exactly what normalization gives a single-line field", () => {
		const raw = `  why\t\u200Bit\n\nfailed ${"z".repeat(300)}  `;
		expect(keptItem({ detail: raw }).detail).toBe(
			clampPluginUiText(raw, PLUGIN_UI_LIMITS.detailChars),
		);
	});

	it("gives exactly what normalization gives a prompt", () => {
		const raw = `\n Fix\tthe \u202Ebuild\n\nthen ${"y".repeat(2_100)} \n`;
		expect(keptItem({ prompt: raw }).prompt).toBe(
			clampPluginUiText(raw, PLUGIN_UI_LIMITS.promptChars, { multiline: true }),
		);
	});

	it("clamps by code points with an ellipsis and is idempotent", () => {
		const clamped = clampPluginUiText(FOUR_BYTE.repeat(10), 4);

		expect(clamped).toBe(`${FOUR_BYTE.repeat(3)}…`);
		expect(clampPluginUiText(clamped, 4)).toBe(clamped);
	});
});

describe("ordering", () => {
	const at = (epoch: number, seq: number): PluginUiStateEnvelope => ({
		sessionId: "s1",
		slot: SLOT,
		plugin: "demo",
		epoch,
		seq,
		state: readyOne,
	});

	it("orders by epoch, then seq", () => {
		expect(comparePluginUiOrder(at(2, 1), at(1, 9))).toBeGreaterThan(0);
		expect(comparePluginUiOrder(at(1, 2), at(1, 3))).toBeLessThan(0);
		expect(comparePluginUiOrder(at(1, 2), at(1, 2))).toBe(0);
	});

	it("takes a new epoch even when its seq starts over", () => {
		const current = at(1_000, 7);
		const restarted = at(1_001, 1);

		expect(applyPluginUiState(current, restarted)).toBe(restarted);
	});

	it("ignores a late lower seq and an equal order", () => {
		const current = at(1_000, 5);

		expect(applyPluginUiState(current, at(1_000, 4))).toBe(current);
		expect(applyPluginUiState(current, at(1_000, 5))).toBe(current);
		expect(applyPluginUiState(undefined, current)).toBe(current);
	});
});

describe("parsePluginUiAction", () => {
	const use = {
		verb: "use",
		input: "key",
		revision: "r1",
		itemId: "verify",
		msSinceExposed: 512,
	};

	it("accepts each verb's shape", () => {
		for (const action of [
			{ verb: "attach", surface: "desktop" },
			{ verb: "detach" },
			{ verb: "exposed", revision: "r1", itemIds: ["a", "b", "c"] },
			use,
			{ ...use, verb: "send" },
			{ ...use, verb: "skip" },
			{ verb: "unskip", input: "pointer", revision: "r1", itemId: "a" },
			{ verb: "clear", revision: "r1", itemId: "a" },
			{ verb: "undo", revision: "r1", itemId: "a" },
			{ verb: "refresh", revision: "r1", input: "command", cause: "more" },
			{ verb: "hide", scope: "chat", input: "pointer" },
			{ verb: "show", input: "pointer" },
			{ verb: "signal", name: "key_inert", reason: "stale", revision: "r1" },
		]) {
			expect(parsePluginUiAction(SLOT, action)).toEqual({
				ok: true,
				slot: SLOT,
				action,
			});
		}
	});

	it("rejects an unknown verb", () => {
		expect(parsePluginUiAction(SLOT, { verb: "explode" })).toEqual({
			ok: false,
			reason: "invalid",
		});
		expect(parsePluginUiAction(SLOT, { verb: "toString" })).toEqual({
			ok: false,
			reason: "invalid",
		});
	});

	it("strips unknown keys", () => {
		expect(parsePluginUiAction(SLOT, { ...use, newerField: true })).toEqual({
			ok: true,
			slot: SLOT,
			action: use,
		});
	});

	it("rejects bad ids, long itemIds and fractional exposure times", () => {
		for (const action of [
			{ ...use, itemId: "has space" },
			{ ...use, revision: "x".repeat(65) },
			{ verb: "exposed", revision: "r1", itemIds: ["a", "b", "c", "d"] },
			{ verb: "exposed", revision: "r1", itemIds: ["a/b"] },
			{ ...use, msSinceExposed: 12.5 },
			{ ...use, msSinceExposed: -1 },
		]) {
			expect(parsePluginUiAction(SLOT, action)).toEqual({
				ok: false,
				reason: "invalid",
			});
		}
	});

	it("rejects values outside their enums", () => {
		for (const action of [
			{ verb: "attach", surface: "web" },
			{ ...use, input: "click" },
			{ verb: "hide", scope: "forever", input: "key" },
			{ verb: "refresh", revision: "r1", input: "key", cause: "bored" },
			{ verb: "signal", name: "key_inert", reason: "tired" },
		]) {
			expect(parsePluginUiAction(SLOT, action)).toEqual({
				ok: false,
				reason: "invalid",
			});
		}
	});

	it("parses show", () => {
		expect(
			parsePluginUiAction(SLOT, { verb: "show", input: "command" }),
		).toEqual({
			ok: true,
			slot: SLOT,
			action: { verb: "show", input: "command" },
		});
	});

	it("rejects an unknown slot and an oversized action", () => {
		expect(parsePluginUiAction("composer.other", use)).toEqual({
			ok: false,
			reason: "unknown_slot",
		});
		expect(
			parsePluginUiAction(SLOT, {
				...use,
				padding: "x".repeat(PLUGIN_UI_LIMITS.actionBytes),
			}),
		).toEqual({ ok: false, reason: "too_large" });
	});
});

describe("readPluginUiEnvelope", () => {
	const envelope: PluginUiStateEnvelope = {
		sessionId: "s1",
		slot: SLOT,
		plugin: "demo",
		epoch: 1_000,
		seq: 2,
		state: readyThree,
	};

	it("re-normalizes the state leniently", () => {
		const newer = {
			...envelope,
			addedLater: true,
			state: {
				...readyThree,
				items: readyThree.items.map((entry) => ({ ...entry, tone: "glow" })),
			},
		};

		expect(readPluginUiEnvelope(newer)).toEqual({
			...envelope,
			state: {
				...readyThree,
				items: readyThree.items.map((entry) => ({ ...entry, tone: "neutral" })),
			},
		});
	});

	it("reads a tombstone", () => {
		expect(readPluginUiEnvelope({ ...envelope, state: null })).toEqual({
			...envelope,
			state: null,
		});
	});

	it("rejects malformed envelopes", () => {
		for (const value of [
			null,
			"envelope",
			{ ...envelope, sessionId: "" },
			{ ...envelope, slot: "composer.other" },
			{ ...envelope, epoch: "1000" },
			{ ...envelope, seq: 1.5 },
			{ ...envelope, state: { ...readyThree, revision: "" } },
		]) {
			expect(readPluginUiEnvelope(value)).toBeUndefined();
			expect(isPluginUiStateEnvelope(value)).toBe(false);
		}
		expect(isPluginUiStateEnvelope(envelope)).toBe(true);
	});

	it("narrows only an envelope whose state is already normalized", () => {
		const hostile = {
			...envelope,
			state: {
				...readyThree,
				items: [
					item("a", { prompt: "/clear" }),
					{
						...item("b"),
						tone: "glow",
						prompt: "Read\u202E it",
						source: { label: "Docs", url: "javascript:alert(1)" },
					},
				],
			},
		};
		const flattened = {
			...envelope,
			state: { ...readyThree, title: { toJSON: () => "Next" } },
		};

		for (const value of [hostile, flattened]) {
			expect(readPluginUiEnvelope(value)).toBeDefined();
			expect(isPluginUiStateEnvelope(value)).toBe(false);
		}
		expect(isPluginUiStateEnvelope({ ...envelope, state: null })).toBe(true);
	});

	it("narrows a normalized envelope whatever its key order", () => {
		const reordered = {
			...envelope,
			state: Object.fromEntries(Object.entries(readyThree).reverse()),
		};

		expect(isPluginUiStateEnvelope(reordered)).toBe(true);
	});
});

describe("readPluginUiSlotCatalog", () => {
	it("keeps known slot ids once", () => {
		expect(readPluginUiSlotCatalog([SLOT, SLOT, "x", 3])).toEqual([SLOT]);
	});

	it("reads anything but an array as no slots", () => {
		expect(readPluginUiSlotCatalog(undefined)).toEqual([]);
		expect(readPluginUiSlotCatalog({})).toEqual([]);
		expect(readPluginUiSlotCatalog(SLOT)).toEqual([]);
	});
});
