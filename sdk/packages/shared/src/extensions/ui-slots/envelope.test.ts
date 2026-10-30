import { describe, expect, it } from "vitest";
import type {
	ComposerSuggestionItem,
	PluginUiStateEnvelope,
} from "./contracts";
import {
	applyPluginUiState,
	comparePluginUiOrder,
	isPluginUiStateEnvelope,
	readPluginUiEnvelope,
} from "./envelope";
import { PLUGIN_UI_FIXTURES } from "./fixtures";

const SLOT = "composer.suggestions";
const { readyOne, readyThree } = PLUGIN_UI_FIXTURES.composerSuggestions;

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
