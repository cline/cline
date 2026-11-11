import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketplaceCatalog } from "./marketplace";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	subscribe: vi.fn(),
	resolveBackend: vi.fn(),
	fetch: vi.fn(),
}));

vi.mock("./desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke, subscribe: mocks.subscribe },
	resolveDesktopBackendHttpEndpoint: mocks.resolveBackend,
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function catalog(name = "Example skill"): MarketplaceCatalog {
	return {
		version: 1,
		counts: { total: 1, plugins: 0, skills: 1, mcps: 0 },
		tags: [],
		entries: [
			{
				id: "example-skill",
				type: "skill",
				name,
				tagline: "A workflow",
				description: "Skill description",
				tags: [],
				install: { command: "", args: ["example/skill"] },
			},
		],
	};
}

let marketplace: typeof import("./marketplace");
let installed: typeof import("./marketplace-installed");
let inventory: typeof import("./extension-inventory");
let now: number;

beforeEach(async () => {
	vi.resetModules();
	vi.resetAllMocks();
	now = 10_000_000;
	vi.spyOn(Date, "now").mockImplementation(() => now);
	vi.stubGlobal("fetch", mocks.fetch);
	mocks.resolveBackend.mockRejectedValue(new Error("No sidecar"));
	mocks.subscribe.mockReturnValue(() => {});
	marketplace = await import("./marketplace");
	installed = await import("./marketplace-installed");
	inventory = await import("./extension-inventory");
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("Shared marketplace catalog", () => {
	it("shares concurrent loads and reuses a fresh catalog across consumers", async () => {
		const response = deferred<Response>();
		mocks.fetch.mockReturnValue(response.promise);
		const first = marketplace.fetchMarketplaceCatalog();
		const second = marketplace.fetchMarketplaceCatalog();
		expect(second).toBe(first);
		expect(marketplace.getCachedMarketplaceCatalog()).toBeNull();
		response.resolve(Response.json(catalog()));
		const value = await first;
		expect(await second).toBe(value);
		expect(await marketplace.fetchMarketplaceCatalog()).toBe(value);
		expect(marketplace.getCachedMarketplaceCatalog()).toBe(value);
		expect(mocks.fetch).toHaveBeenCalledTimes(1);
	});

	it("keeps the previous catalog visible while an expired load refreshes", async () => {
		mocks.fetch.mockResolvedValueOnce(Response.json(catalog()));
		const previous = await marketplace.fetchMarketplaceCatalog();
		now += 5 * 60_000;
		const response = deferred<Response>();
		mocks.fetch.mockReturnValue(response.promise);
		const refresh = marketplace.fetchMarketplaceCatalog();
		expect(marketplace.fetchMarketplaceCatalog()).toBe(refresh);
		expect(marketplace.getCachedMarketplaceCatalog()).toBe(previous);
		response.resolve(Response.json(catalog("Updated skill")));
		const updated = await refresh;
		expect(updated.entries[0].name).toBe("Updated skill");
		expect(marketplace.getCachedMarketplaceCatalog()).toBe(updated);
		expect(mocks.fetch).toHaveBeenCalledTimes(2);
	});

	it("preserves a cached catalog after a failed refresh and allows retry", async () => {
		mocks.fetch.mockResolvedValueOnce(Response.json(catalog()));
		const previous = await marketplace.fetchMarketplaceCatalog();
		now += 5 * 60_000;
		mocks.fetch.mockRejectedValueOnce(new Error("Offline"));
		await expect(marketplace.fetchMarketplaceCatalog()).rejects.toThrow(
			"Offline",
		);
		expect(marketplace.getCachedMarketplaceCatalog()).toBe(previous);
		mocks.fetch.mockResolvedValueOnce(
			Response.json(catalog("Recovered skill")),
		);
		expect((await marketplace.fetchMarketplaceCatalog()).entries[0].name).toBe(
			"Recovered skill",
		);
		expect(mocks.fetch).toHaveBeenCalledTimes(3);
	});

	it("rejects an HTTP 200 error fallback without caching it and retries successfully", async () => {
		mocks.resolveBackend.mockResolvedValue("http://localhost:3126");
		mocks.fetch.mockResolvedValueOnce(
			Response.json({
				...marketplace.EMPTY_CATALOG,
				error: "upstream unavailable",
			}),
		);
		await expect(marketplace.fetchMarketplaceCatalog()).rejects.toThrow(
			"upstream unavailable",
		);
		expect(marketplace.getCachedMarketplaceCatalog()).toBeNull();
		mocks.fetch.mockResolvedValueOnce(Response.json(catalog()));
		const recovered = await marketplace.fetchMarketplaceCatalog();
		expect(recovered.entries[0].name).toBe("Example skill");
		expect(marketplace.getCachedMarketplaceCatalog()).toBe(recovered);
		expect(mocks.fetch).toHaveBeenCalledTimes(2);
		expect(mocks.fetch).toHaveBeenLastCalledWith(
			"http://localhost:3126/api/marketplace/catalog",
			{ headers: { Accept: "application/json" } },
		);
	});
});

describe("Shared marketplace installed status", () => {
	it("deduplicates equivalent catalogs and reuses their installed status", async () => {
		const response = deferred<{ installedKeys: string[] }>();
		mocks.invoke.mockReturnValue(response.promise);
		const first = installed.fetchMarketplaceInstalledEntries(catalog());
		const second = installed.fetchMarketplaceInstalledEntries(
			catalog("Renamed skill"),
		);
		expect(second).toBe(first);
		response.resolve({ installedKeys: ["skill:example-skill"] });
		const value = await first;
		expect(await second).toBe(value);
		expect(await installed.fetchMarketplaceInstalledEntries(catalog())).toBe(
			value,
		);
		expect(installed.getCachedMarketplaceInstalledEntries(catalog())).toBe(
			value,
		);
		expect(mocks.invoke).toHaveBeenCalledTimes(1);
		expect(mocks.invoke).toHaveBeenCalledWith(
			"list_marketplace_installed_entries",
			{ entries: catalog().entries },
		);
	});

	it("does not reuse installed status for a changed install source", async () => {
		mocks.invoke.mockResolvedValueOnce({
			installedKeys: ["skill:example-skill"],
		});
		await installed.fetchMarketplaceInstalledEntries(catalog());
		const changed = catalog();
		changed.entries[0].install.args = ["different/skill"];
		expect(installed.getCachedMarketplaceInstalledEntries(changed)).toBeNull();
		mocks.invoke.mockResolvedValueOnce({ installedKeys: [] });
		expect(await installed.fetchMarketplaceInstalledEntries(changed)).toEqual({
			installedKeys: [],
		});
		expect(mocks.invoke).toHaveBeenCalledTimes(2);
	});

	it("retains stale installed status while refreshing and retries after failure", async () => {
		mocks.invoke.mockResolvedValueOnce({
			installedKeys: ["skill:example-skill"],
		});
		const previous = await installed.fetchMarketplaceInstalledEntries(
			catalog(),
		);
		now += 60_000;
		const response = deferred<{ installedKeys: string[] }>();
		mocks.invoke.mockReturnValueOnce(response.promise);
		const refresh = installed.fetchMarketplaceInstalledEntries(catalog());
		expect(installed.getCachedMarketplaceInstalledEntries(catalog())).toBe(
			previous,
		);
		const failed = expect(refresh).rejects.toThrow("Unavailable");
		response.reject(new Error("Unavailable"));
		await failed;
		expect(installed.getCachedMarketplaceInstalledEntries(catalog())).toBe(
			previous,
		);
		mocks.invoke.mockResolvedValueOnce({ installedKeys: [] });
		expect(await installed.fetchMarketplaceInstalledEntries(catalog())).toEqual(
			{ installedKeys: [] },
		);
		expect(mocks.invoke).toHaveBeenCalledTimes(3);
	});

	it("ignores a pre-invalidation response and resolves its readers with the replacement", async () => {
		const oldResponse = deferred<{ installedKeys: string[] }>();
		const freshResponse = deferred<{ installedKeys: string[] }>();
		mocks.invoke
			.mockReturnValueOnce(oldResponse.promise)
			.mockReturnValueOnce(freshResponse.promise);
		const oldRead = installed.fetchMarketplaceInstalledEntries(catalog());
		inventory.invalidateExtensionInventoryCache();
		const freshRead = installed.fetchMarketplaceInstalledEntries(catalog());
		oldResponse.resolve({ installedKeys: [] });
		await Promise.resolve();
		expect(
			installed.getCachedMarketplaceInstalledEntries(catalog()),
		).toBeNull();
		freshResponse.resolve({ installedKeys: ["skill:example-skill"] });
		const fresh = await freshRead;
		expect(await oldRead).toBe(fresh);
		expect(installed.getCachedMarketplaceInstalledEntries(catalog())).toBe(
			fresh,
		);
		expect(mocks.invoke).toHaveBeenCalledTimes(2);
	});

	it.each([
		true,
		false,
	])("preserves a completed mutation (installed=%s) when an older read settles", async (isInstalled) => {
		const oldValue = {
			installedKeys: isInstalled ? [] : ["skill:example-skill"],
		};
		const freshValue = {
			installedKeys: isInstalled ? ["skill:example-skill"] : [],
		};
		mocks.invoke.mockResolvedValueOnce(oldValue);
		await installed.fetchMarketplaceInstalledEntries(catalog());
		const oldResponse = deferred<{ installedKeys: string[] }>();
		mocks.invoke.mockReturnValueOnce(oldResponse.promise);
		const oldRead = installed.fetchMarketplaceInstalledEntries(catalog(), {
			force: true,
		});
		installed.updateCachedMarketplaceEntry(catalog().entries[0], isInstalled);
		expect(installed.getCachedMarketplaceInstalledEntries(catalog())).toEqual(
			freshValue,
		);
		const freshRead = installed.fetchMarketplaceInstalledEntries(catalog());
		oldResponse.resolve(oldValue);
		expect(await oldRead).toEqual(freshValue);
		expect(await freshRead).toEqual(freshValue);
		expect(installed.getCachedMarketplaceInstalledEntries(catalog())).toEqual(
			freshValue,
		);
		expect(mocks.invoke).toHaveBeenCalledTimes(2);
	});

	it("clears workspace-specific status when settings change and subscribes only once", async () => {
		mocks.invoke.mockResolvedValue({ installedKeys: ["skill:example-skill"] });
		await installed.fetchMarketplaceInstalledEntries(catalog());
		await installed.fetchMarketplaceInstalledEntries(catalog());
		expect(mocks.subscribe).toHaveBeenCalledTimes(1);
		expect(mocks.subscribe.mock.calls[0][0]).toBe("settings.changed");
		mocks.subscribe.mock.calls[0][1]();
		expect(
			installed.getCachedMarketplaceInstalledEntries(catalog()),
		).toBeNull();
		mocks.invoke.mockResolvedValueOnce({ installedKeys: [] });
		expect(await installed.fetchMarketplaceInstalledEntries(catalog())).toEqual(
			{ installedKeys: [] },
		);
		expect(mocks.invoke).toHaveBeenCalledTimes(2);
	});
});
