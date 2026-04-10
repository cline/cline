import { describe, expect, it } from "vitest";
import { BoundedTtlCache } from "./bounded-ttl-cache";

describe("BoundedTtlCache", () => {
	it("returns undefined after TTL", () => {
		const cache = new BoundedTtlCache(1_000, 10);
		cache.set("a", "one", 0);
		expect(cache.get("a", 500)).toBe("one");
		expect(cache.get("a", 1_500)).toBeUndefined();
	});

	it("evicts oldest entries when over max size", () => {
		const cache = new BoundedTtlCache(60_000, 2);
		cache.set("a", "1", 0);
		cache.set("b", "2", 0);
		cache.set("c", "3", 0);
		expect(cache.get("a", 0)).toBeUndefined();
		expect(cache.get("b", 0)).toBe("2");
		expect(cache.get("c", 0)).toBe("3");
	});

	it("refreshes recency on get so hot keys survive eviction", () => {
		const cache = new BoundedTtlCache(60_000, 2);
		cache.set("a", "1", 0);
		cache.set("b", "2", 0);
		expect(cache.get("a", 0)).toBe("1");
		cache.set("c", "3", 0);
		expect(cache.get("a", 0)).toBe("1");
		expect(cache.get("b", 0)).toBeUndefined();
	});

	it("supports per-entry TTL override", () => {
		const cache = new BoundedTtlCache(60_000, 2);
		cache.set("short", "v", 0, 1_000);
		expect(cache.get("short", 500)).toBe("v");
		expect(cache.get("short", 1_500)).toBeUndefined();
	});
});
