import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APPROVAL_POLICY } from "@/session";
import {
	APPROVAL_POLICY_STORAGE_KEY,
	ApprovalPolicyStore,
	type SettingsPersistence,
} from "./approval-policy-store";

function fakePersistence(seed?: string): SettingsPersistence & {
	items: Map<string, string>;
} {
	const items = new Map<string, string>();
	if (seed !== undefined) {
		items.set(APPROVAL_POLICY_STORAGE_KEY, seed);
	}
	return {
		items,
		getItem: async (key) => items.get(key) ?? null,
		setItem: async (key, value) => {
			items.set(key, value);
		},
		deleteItem: async (key) => {
			items.delete(key);
		},
	};
}

describe("ApprovalPolicyStore", () => {
	it("uses the all-auto default when no policy has been saved", async () => {
		const store = new ApprovalPolicyStore(fakePersistence());
		await store.hydrate();
		expect(store.get()).toEqual(DEFAULT_APPROVAL_POLICY);
	});

	it("writes a tier change through to persistence", async () => {
		const persistence = fakePersistence();
		const store = new ApprovalPolicyStore(persistence);

		await store.setTier("execute", "ask");

		expect(store.get()).toEqual({
			read: "auto",
			write: "auto",
			execute: "ask",
		});
		expect(
			JSON.parse(persistence.items.get(APPROVAL_POLICY_STORAGE_KEY) ?? "{}"),
		).toEqual({ read: "auto", write: "auto", execute: "ask" });
	});

	it.each([
		{ read: "ask", write: "ask", execute: "ask" },
		{ read: "auto", write: "ask", execute: "ask" },
	])("preserves a saved policy on hydration: %j", async (saved) => {
		const store = new ApprovalPolicyStore(
			fakePersistence(JSON.stringify(saved)),
		);

		await store.hydrate();

		expect(store.get()).toEqual(saved);
	});

	it("asks before running tools when a stored blob is corrupt", async () => {
		const store = new ApprovalPolicyStore(fakePersistence("not json{"));
		await store.hydrate();
		expect(store.get()).toEqual({ read: "ask", write: "ask", execute: "ask" });
	});

	it("asks for an unrecognised tier value, keeping valid siblings", async () => {
		const store = new ApprovalPolicyStore(
			fakePersistence(
				JSON.stringify({ read: "ask", write: "yolo", execute: "auto" }),
			),
		);

		await store.hydrate();

		// A corrupt saved choice must not turn on unattended writes.
		expect(store.get()).toEqual({
			read: "ask",
			write: "ask",
			execute: "auto",
		});
	});

	it("ignores extra keys and a non-object blob", async () => {
		const extra = new ApprovalPolicyStore(
			fakePersistence(JSON.stringify({ read: "ask", nonsense: "auto" })),
		);
		await extra.hydrate();
		expect(extra.get()).toEqual({ read: "ask", write: "ask", execute: "ask" });

		const array = new ApprovalPolicyStore(fakePersistence("[1,2,3]"));
		await array.hydrate();
		expect(array.get()).toEqual({ read: "ask", write: "ask", execute: "ask" });
	});

	it("survives a rejected read", async () => {
		const store = new ApprovalPolicyStore({
			getItem: async () => {
				throw new Error("keychain unavailable");
			},
			setItem: async () => {},
			deleteItem: async () => {},
		});
		await expect(store.hydrate()).resolves.toBeUndefined();
		expect(store.get()).toEqual({ read: "ask", write: "ask", execute: "ask" });
	});

	it("notifies subscribers on every change and stops after unsubscribe", async () => {
		const store = new ApprovalPolicyStore();
		const seen: string[] = [];
		const unsubscribe = store.subscribe((policy) => seen.push(policy.execute));

		await store.setTier("execute", "ask");
		unsubscribe();
		await store.setTier("execute", "auto");

		expect(seen).toEqual(["ask"]);
		expect(store.get().execute).toBe("auto");
	});

	it("keeps a listener fault from breaking the store", async () => {
		const store = new ApprovalPolicyStore();
		store.subscribe(() => {
			throw new Error("bad render");
		});
		const ok = vi.fn();
		store.subscribe(ok);

		await store.setTier("write", "ask");

		expect(ok).toHaveBeenCalledTimes(1);
		expect(store.get().write).toBe("ask");
	});

	it("emits a new object each change so React state updates are seen", async () => {
		const store = new ApprovalPolicyStore();
		const first = store.get();
		await store.setTier("write", "ask");
		expect(store.get()).not.toBe(first);
	});

	it("resets back to the default and clears the stored blob", async () => {
		const persistence = fakePersistence();
		const store = new ApprovalPolicyStore(persistence);
		await store.setTier("execute", "ask");

		await store.reset();

		expect(store.get()).toEqual(DEFAULT_APPROVAL_POLICY);
		expect(persistence.items.has(APPROVAL_POLICY_STORAGE_KEY)).toBe(false);
	});
});
