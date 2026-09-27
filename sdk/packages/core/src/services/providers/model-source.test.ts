import { describe, expect, it } from "vitest";
import {
	extractModelEntriesFromPayload,
	mergeModelEntries,
} from "./model-source";

describe("extractModelEntriesFromPayload", () => {
	it("parses plain string entries", () => {
		expect(extractModelEntriesFromPayload(["a", " b "], "p")).toEqual([
			{ id: "a" },
			{ id: "b" },
		]);
	});

	it("carries context fields from OpenAI-compatible object entries", () => {
		const payload = {
			data: [
				{
					id: "stealth/space-bunny-alpha",
					name: "Space Bunny Alpha",
					context_length: 1_000_000,
					max_completion_tokens: 64_000,
				},
				{ id: "stealth/small", context_length: 8_192 },
			],
		};
		expect(extractModelEntriesFromPayload(payload, "p")).toEqual([
			{
				id: "stealth/space-bunny-alpha",
				contextLength: 1_000_000,
				maxCompletionTokens: 64_000,
			},
			{ id: "stealth/small", contextLength: 8_192 },
		]);
	});

	it("drops non-positive and non-numeric context fields", () => {
		const payload = [
			{ id: "a", context_length: 0 },
			{ id: "b", context_length: -5 },
			{ id: "c", context_length: "not-a-number" },
			{ id: "d", context_length: "128000" },
			{ id: "e", max_completion_tokens: null },
			{ id: "f", context_length: 2.5 },
		];
		expect(extractModelEntriesFromPayload(payload, "p")).toEqual([
			{ id: "a" },
			{ id: "b" },
			{ id: "c" },
			{ id: "d", contextLength: 128_000 },
			{ id: "e" },
			{ id: "f" },
		]);
	});

	it("still falls back to name and model fields for the id", () => {
		expect(
			extractModelEntriesFromPayload(
				[{ name: "n", context_length: 4096 }, { model: "m" }],
				"p",
			),
		).toEqual([{ id: "n", contextLength: 4096 }, { id: "m" }]);
	});

	it("reads entries from a data array, a models array, key maps, and a scoped provider", () => {
		const dataShape = { data: [{ id: "a" }] };
		const modelsShape = { models: ["b"] };
		const keyMapShape = {
			models: {
				" c ": { context_length: 1 },
				d: { max_completion_tokens: 512 },
				e: "just a name",
				"   ": { context_length: 9 },
			},
		};
		const scopedShape = { providers: { p: { models: [{ id: "g" }] } } };
		const scopedMapShape = {
			providers: { p: { models: { f: { context_length: 2_048 } } } },
		};
		const scopedArrayShape = { providers: { p: ["h", " i "] } };
		const scopedUnparseableShape = { providers: { p: { models: [{}, ""] } } };

		expect(extractModelEntriesFromPayload(dataShape, "p")).toEqual([
			{ id: "a" },
		]);
		expect(extractModelEntriesFromPayload(modelsShape, "p")).toEqual([
			{ id: "b" },
		]);
		expect(extractModelEntriesFromPayload(keyMapShape, "p")).toEqual([
			{ id: "c", contextLength: 1 },
			{ id: "d", maxCompletionTokens: 512 },
			{ id: "e" },
		]);
		expect(extractModelEntriesFromPayload(scopedShape, "p")).toEqual([
			{ id: "g" },
		]);
		expect(extractModelEntriesFromPayload(scopedMapShape, "p")).toEqual([
			{ id: "f", contextLength: 2_048 },
		]);
		expect(extractModelEntriesFromPayload(scopedArrayShape, "p")).toEqual([
			{ id: "h" },
			{ id: "i" },
		]);
		// An array of unparseable entries must not fall through to the map
		// parser, which would turn the array indices into model ids.
		expect(extractModelEntriesFromPayload(scopedUnparseableShape, "p")).toEqual(
			[],
		);
	});
});

describe("mergeModelEntries", () => {
	it("keeps the first position and the first defined limits per id", () => {
		expect(
			mergeModelEntries([
				{ id: "a", contextLength: 262_144, maxCompletionTokens: 8_192 },
				{ id: "b" },
				{ id: "a" },
				{ id: "b", contextLength: 32_768 },
				{ id: "a", contextLength: 1 },
			]),
		).toEqual([
			{ id: "a", contextLength: 262_144, maxCompletionTokens: 8_192 },
			{ id: "b", contextLength: 32_768 },
		]);
	});
});
