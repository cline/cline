/**
 * The recency this device actually observed. The list orders rows by it, so a
 * corrupt or hostile stored value must be dropped rather than trusted, and an
 * out-of-order write must never move a row *back* up the list.
 */

import { describe, expect, it } from "vitest";
import {
	LAST_OPENED_MAX_ENTRIES,
	LAST_OPENED_STORAGE_KEY,
	type LastOpenedPersistence,
	LastOpenedStore,
} from "./last-opened";

function memoryPersistence(seed: Record<string, string> = {}): {
	persistence: LastOpenedPersistence;
	blob: Record<string, string>;
} {
	const blob: Record<string, string> = { ...seed };
	return {
		blob,
		persistence: {
			getItem: async (key) => blob[key] ?? null,
			setItem: async (key, value) => {
				blob[key] = value;
			},
			deleteItem: async (key) => {
				delete blob[key];
			},
		},
	};
}

describe("LastOpenedStore", () => {
	it("records an open and writes it through", async () => {
		const { persistence, blob } = memoryPersistence();
		const store = new LastOpenedStore(persistence);
		await store.touch("a", 1_000);
		expect(store.get("a")).toBe(1_000);
		expect(JSON.parse(blob[LAST_OPENED_STORAGE_KEY] as string)).toEqual({
			a: 1_000,
		});
	});

	it("keeps the newest open and ignores a late, older one", async () => {
		const store = new LastOpenedStore();
		await store.touch("a", 2_000);
		await store.touch("a", 1_000);
		expect(store.get("a")).toBe(2_000);
	});

	it("notifies subscribers with a plain snapshot", async () => {
		const store = new LastOpenedStore();
		const seen: Record<string, number>[] = [];
		const unsubscribe = store.subscribe((value) => seen.push({ ...value }));
		await store.touch("a", 1);
		await store.touch("b", 2);
		unsubscribe();
		await store.touch("c", 3);
		expect(seen).toEqual([{ a: 1 }, { a: 1, b: 2 }]);
	});

	it("survives a listener that throws", async () => {
		const store = new LastOpenedStore();
		store.subscribe(() => {
			throw new Error("boom");
		});
		await expect(store.touch("a", 1)).resolves.toBeUndefined();
		expect(store.get("a")).toBe(1);
	});

	it("hydrates the entries it can trust and drops the rest", async () => {
		const { persistence } = memoryPersistence({
			[LAST_OPENED_STORAGE_KEY]: JSON.stringify({
				good: 1_000,
				text: "yesterday",
				fractional: 1.5,
				nested: { at: 1 },
			}),
		});
		const store = new LastOpenedStore(persistence);
		await store.hydrate();
		expect(store.snapshot()).toEqual({ good: 1_000 });
	});

	it("discards a corrupt blob instead of failing startup", async () => {
		const { persistence } = memoryPersistence({
			[LAST_OPENED_STORAGE_KEY]: "{not json",
		});
		const store = new LastOpenedStore(persistence);
		await expect(store.hydrate()).resolves.toBeUndefined();
		expect(store.snapshot()).toEqual({});
	});

	it("forgets a single entry and clears the lot", async () => {
		const { persistence, blob } = memoryPersistence();
		const store = new LastOpenedStore(persistence);
		await store.touch("a", 1);
		await store.touch("b", 2);
		await store.forget("a");
		expect(store.snapshot()).toEqual({ b: 2 });
		await store.clear();
		expect(store.snapshot()).toEqual({});
		expect(blob[LAST_OPENED_STORAGE_KEY]).toBeUndefined();
	});

	it("keeps only the most recent entries", async () => {
		const store = new LastOpenedStore();
		for (let index = 0; index < LAST_OPENED_MAX_ENTRIES + 10; index += 1) {
			await store.touch(`key-${index}`, 1_000 + index);
		}
		const snapshot = store.snapshot();
		expect(Object.keys(snapshot)).toHaveLength(LAST_OPENED_MAX_ENTRIES);
		expect(snapshot["key-0"]).toBeUndefined();
		expect(snapshot[`key-${LAST_OPENED_MAX_ENTRIES + 9}`]).toBe(
			1_000 + LAST_OPENED_MAX_ENTRIES + 9,
		);
	});

	it("does nothing without persistence", async () => {
		const store = new LastOpenedStore();
		await expect(store.hydrate()).resolves.toBeUndefined();
		await expect(store.forget("missing")).resolves.toBeUndefined();
	});
});
