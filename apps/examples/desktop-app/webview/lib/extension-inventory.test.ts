import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	commitExtensionInventoryResponse,
	commitMcpServersResponse,
	fetchExtensionInventory,
	fetchMcpServers,
	getCachedExtensionInventory,
	getCachedMcpServers,
	invalidateExtensionInventoryCache,
	subscribeToExtensionInventoryInvalidation,
} from "./extension-inventory";

const { invoke, subscribe } = vi.hoisted(() => ({
	invoke: vi.fn(),
	subscribe: vi.fn(() => () => {}),
}));
vi.mock("./desktop-client", () => ({ desktopClient: { invoke, subscribe } }));

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

const firstInventory = {
	rules: [{ name: "First rule", instructions: "", path: "/rules/first.md" }],
};
const nextInventory = {
	rules: [{ name: "New rule", instructions: "", path: "/rules/new.md" }],
};
const mcpInventory = {
	settingsPath: "/settings.json",
	hasSettingsFile: true,
	servers: [
		{ name: "server", disabled: false, transportType: "stdio" as const },
	],
};

beforeEach(() => {
	invalidateExtensionInventoryCache();
	invoke.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("shared customization inventory", () => {
	it("observes settings for subscribers before any inventory read and distinguishes invalidations", () => {
		const listener = vi.fn();
		const unsubscribe = subscribeToExtensionInventoryInvalidation(listener);
		try {
			expect(subscribe).toHaveBeenCalledOnce();
			expect(invoke).not.toHaveBeenCalled();
			invalidateExtensionInventoryCache();
			commitExtensionInventoryResponse(firstInventory);
			commitMcpServersResponse(mcpInventory);
			expect(listener.mock.calls).toEqual([
				["inventory"],
				["inventory"],
				["inventory"],
			]);
			const onSettingsChanged = (
				subscribe.mock.calls as unknown as Array<[string, () => void]>
			)[0][1];
			onSettingsChanged();
			expect(listener.mock.calls).toEqual([
				["inventory"],
				["inventory"],
				["inventory"],
				["settings"],
			]);
			expect(getCachedExtensionInventory()).toBeNull();
			expect(getCachedMcpServers()).toBeNull();
		} finally {
			unsubscribe();
		}
	});

	it("combines concurrent category/count requests and caches valid empty tool lists", async () => {
		const pending = deferred<typeof firstInventory>();
		invoke.mockReturnValue(pending.promise);
		const requests = Array.from({ length: 6 }, () => fetchExtensionInventory());
		expect(invoke).toHaveBeenCalledOnce();
		pending.resolve(firstInventory);
		const results = await Promise.all(requests);
		expect(results.every((result) => result === results[0])).toBe(true);
		expect(results[0].tools).toEqual([]);
		expect(await fetchExtensionInventory()).toBe(results[0]);
		expect(invoke).toHaveBeenCalledOnce();
	});

	it("retains a stale snapshot while one replacement request refreshes it", async () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
		invoke.mockResolvedValueOnce(firstInventory);
		const original = await fetchExtensionInventory();
		now.mockReturnValue(62_000);
		const pending = deferred<typeof nextInventory>();
		invoke.mockReturnValueOnce(pending.promise);
		const refresh = fetchExtensionInventory();
		expect(getCachedExtensionInventory()).toBe(original);
		expect(fetchExtensionInventory({ force: true })).toBe(refresh);
		expect(invoke).toHaveBeenCalledTimes(2);
		pending.resolve(nextInventory);
		expect((await refresh).rules[0].name).toBe("New rule");
	});

	it("invalidates before listeners refetch and supersedes the old in-flight result", async () => {
		const old = deferred<typeof firstInventory>();
		const current = deferred<typeof nextInventory>();
		invoke
			.mockReturnValueOnce(old.promise)
			.mockReturnValueOnce(current.promise);
		const staleRequest = fetchExtensionInventory();
		const refreshed: Array<ReturnType<typeof fetchExtensionInventory>> = [];
		const unsubscribe = Array.from({ length: 6 }, () =>
			subscribeToExtensionInventoryInvalidation(() => {
				refreshed.push(fetchExtensionInventory());
			}),
		);
		try {
			invalidateExtensionInventoryCache();
			expect(invoke).toHaveBeenCalledTimes(2);
			old.resolve(firstInventory);
			current.resolve(nextInventory);
			const results = await Promise.all([staleRequest, ...refreshed]);
			expect(
				results.every((result) => result.rules[0].name === "New rule"),
			).toBe(true);
			expect(getCachedExtensionInventory()?.rules[0].name).toBe("New rule");
		} finally {
			for (const stop of unsubscribe) stop();
		}
	});

	it.each([
		"success",
		"failure",
	])("keeps a mutation response when an older read ends in %s", async (outcome) => {
		const pending = deferred<typeof firstInventory>();
		invoke.mockReturnValueOnce(pending.promise);
		const stale = fetchExtensionInventory();
		const committed = commitExtensionInventoryResponse(nextInventory);
		if (outcome === "success") pending.resolve(firstInventory);
		else pending.reject(new Error("Old request failed"));
		expect(await stale).toBe(committed);
		expect(getCachedExtensionInventory()).toBe(committed);
		expect(invoke).toHaveBeenCalledOnce();
	});

	it("retries after a failure without discarding previously displayed data", async () => {
		invoke.mockResolvedValueOnce(firstInventory);
		const original = await fetchExtensionInventory();
		invoke.mockRejectedValueOnce(new Error("Unavailable"));
		await expect(fetchExtensionInventory({ force: true })).rejects.toThrow(
			"Unavailable",
		);
		expect(getCachedExtensionInventory()).toBe(original);
		invoke.mockResolvedValueOnce(nextInventory);
		expect((await fetchExtensionInventory({ force: true })).rules[0].name).toBe(
			"New rule",
		);
	});

	it("observes settings changes while all views are unmounted", async () => {
		invoke.mockResolvedValueOnce(firstInventory);
		await fetchExtensionInventory();
		const listener = (
			subscribe.mock.calls as unknown as Array<[string, () => void]>
		).find(([event]) => event === "settings.changed")?.[1];
		expect(listener).toBeTypeOf("function");
		listener?.();
		expect(getCachedExtensionInventory()).toBeNull();
		invoke.mockResolvedValueOnce(nextInventory);
		expect((await fetchExtensionInventory()).rules[0].name).toBe("New rule");
	});

	it("reuses MCP lists and keeps mutation results over older reads", async () => {
		const pending = deferred<typeof mcpInventory>();
		invoke.mockReturnValueOnce(pending.promise);
		const first = fetchMcpServers();
		expect(fetchMcpServers()).toBe(first);
		pending.resolve(mcpInventory);
		expect(await first).toBe(mcpInventory);
		expect(await fetchMcpServers()).toBe(mcpInventory);
		expect(invoke).toHaveBeenCalledOnce();

		const old = deferred<typeof mcpInventory>();
		invoke.mockReturnValueOnce(old.promise);
		const refresh = fetchMcpServers({ force: true });
		const updated = { ...mcpInventory, servers: [] };
		commitMcpServersResponse(updated);
		old.resolve(mcpInventory);
		expect(await refresh).toBe(updated);
		expect(getCachedMcpServers()).toBe(updated);
	});
});
