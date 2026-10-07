import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
	prepareToolResultPreview,
	prepareToolResultRecovery,
	TOOL_RESULT_CACHE_MISS,
	ToolResultCache,
} from "./tool-result-cache";

describe("session memory result cache", () => {
	it("preserves structured fields and multiline text in YAML while leaving strings unchanged", () => {
		const output = {
			content: [{ type: "text", text: "first\nsecond\nthird" }],
			isError: false,
			structuredContent: { count: 3 },
		};
		const { text } = prepareToolResultRecovery(output);
		expect(YAML.parse(text ?? "")).toEqual(output);
		expect(text).toContain("text: |-\n");
		expect(text).not.toContain("first\\nsecond");
		expect(prepareToolResultRecovery("first\nsecond").text).toBe(
			"first\nsecond",
		);
		expect(prepareToolResultRecovery(undefined).text).toBeUndefined();
	});
	it.each([
		"mediaType",
		"mimeType",
	])("excludes %s image bytes from recovery text without evicting other results", (mimeField) => {
		const image = {
			type: "image" as const,
			data: "x".repeat(17 * 1024 * 1024),
			[mimeField]: "image/png",
		};
		const { text, images } = prepareToolResultRecovery([
			{ type: "text", text: "recover me".repeat(1000) },
			image,
		]);
		expect(images).toEqual([
			{ type: "image", data: image.data, mediaType: "image/png" },
		]);
		const preview = prepareToolResultPreview([image]);
		expect(preview.images).toEqual(images);
		expect(preview.text).not.toContain(image.data);
		expect(text).toContain("[image attached]");
		expect(text?.length).toBeLessThan(11000);
		const cache = new ToolResultCache("session");
		const otherUri = cache.store("other", "keep this result") ?? "";
		const uri = cache.store("call", text ?? "") ?? "";
		expect(uri).not.toBe("");
		expect(cache.read(uri)).toContain("recover me");
		expect(cache.read(otherUri)).toBe("keep this result");
	});
	it("uses a unique URI for each execution and scopes reads to the owning session", () => {
		const first = new ToolResultCache("root@one+two");
		const second = new ToolResultCache("other");
		const uri = first.store("call", "full response") ?? "";
		expect(uri).toMatch(/^cline:\/\/cache\/root%40one%2Btwo\/.+\.result\.txt$/);
		expect(first.read(uri)).toBe("full response");
		expect(() => second.read(uri)).toThrow("for this session"); // Cross-session reads must not fall through to disk.
	});

	it("repeated lookups do not refresh the five-iteration expiry", () => {
		const cache = new ToolResultCache("session");
		const uri = cache.store("call", "original") ?? "";
		for (let index = 0; index < 4; index++) {
			cache.advanceIteration();
			expect(cache.uriFor("call")).toBe(uri);
		}
		cache.advanceIteration();
		expect(cache.uriFor("call")).toBe(uri);
		expect(() => cache.read(uri)).toThrow(TOOL_RESULT_CACHE_MISS);
	});

	it("explicit reads refresh expiry", () => {
		const cache = new ToolResultCache("session");
		const uri = cache.store("call", "full") ?? "";
		for (let index = 0; index < 4; index++) cache.advanceIteration();
		expect(cache.read(uri)).toBe("full");
		for (let index = 0; index < 4; index++) cache.advanceIteration();
		expect(cache.uriFor("call")).toBe(uri);
		cache.advanceIteration();
		expect(() => cache.read(uri)).toThrow(TOOL_RESULT_CACHE_MISS);
	});

	it("bounds cached bytes and evicts the least recently read result", () => {
		const cache = new ToolResultCache("session", 8);
		const first = cache.store("first", "1111") ?? "";
		const second = cache.store("second", "2222") ?? "";
		cache.read(first);
		cache.store("third", "3333");
		expect(() => cache.read(second)).toThrow(TOOL_RESULT_CACHE_MISS);
		expect(cache.uriFor("second")).toBe(second);
		expect(cache.read(first)).toBe("1111");
		expect(cache.store("too-large", "x".repeat(9))).toBeUndefined();
		expect(cache.uriFor("first")).toBe(first);
	});

	it("counts multibyte text, replaces repeated IDs, and clears entries", () => {
		const cache = new ToolResultCache("session", 8);
		const old = cache.store("call", "🙂🙂") ?? "";
		expect(cache.store("another", "🙂🙂🙂")).toBeUndefined();
		const current = cache.store("call", "new") ?? "";
		expect(current).not.toBe(old);
		expect(() => cache.read(old)).toThrow(TOOL_RESULT_CACHE_MISS);
		expect(cache.read(current)).toBe("new");
		cache.clear();
		expect(() => cache.read(current)).toThrow(TOOL_RESULT_CACHE_MISS);
	});
});
