import { describe, expect, it } from "vitest";
import { TOOL_RESULT_CACHE_MISS, ToolResultCache } from "./tool-result-cache";

describe("session memory result cache", () => {
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
		expect(cache.uriFor("call")).toBeUndefined();
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
