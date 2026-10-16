import { describe, expect, it } from "vitest";
import { PLUGIN_UI_LIMITS } from "../constants";
import { parsePluginUiAction } from "./action";

const SLOT = "composer.suggestions";

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
