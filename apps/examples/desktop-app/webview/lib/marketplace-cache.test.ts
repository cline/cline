import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketplaceCatalog } from "./marketplace";

const mocks = vi.hoisted(() => ({
	resolveBackend: vi.fn(),
	fetch: vi.fn(),
}));

vi.mock("./desktop-client", () => ({
	resolveDesktopBackendHttpEndpoint: mocks.resolveBackend,
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
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
let now: number;

beforeEach(async () => {
	vi.resetModules();
	vi.resetAllMocks();
	now = 10_000_000;
	vi.spyOn(Date, "now").mockImplementation(() => now);
	vi.stubGlobal("fetch", mocks.fetch);
	mocks.resolveBackend.mockRejectedValue(new Error("No sidecar"));
	marketplace = await import("./marketplace");
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
		response.resolve(Response.json(catalog()));
		const value = await first;
		expect(await second).toBe(value);
		expect(await marketplace.fetchMarketplaceCatalog()).toBe(value);
		expect(mocks.fetch).toHaveBeenCalledTimes(1);
	});

	it("shares an expired catalog refresh across consumers", async () => {
		mocks.fetch.mockResolvedValueOnce(Response.json(catalog()));
		await marketplace.fetchMarketplaceCatalog();
		now += 5 * 60_000;
		const response = deferred<Response>();
		mocks.fetch.mockReturnValue(response.promise);
		const refresh = marketplace.fetchMarketplaceCatalog();
		expect(marketplace.fetchMarketplaceCatalog()).toBe(refresh);
		response.resolve(Response.json(catalog("Updated skill")));
		const updated = await refresh;
		expect(updated.entries[0].name).toBe("Updated skill");
		expect(mocks.fetch).toHaveBeenCalledTimes(2);
	});

	it("allows retry after a failed refresh", async () => {
		mocks.fetch.mockResolvedValueOnce(Response.json(catalog()));
		await marketplace.fetchMarketplaceCatalog();
		now += 5 * 60_000;
		mocks.fetch.mockRejectedValueOnce(new Error("Offline"));
		await expect(marketplace.fetchMarketplaceCatalog()).rejects.toThrow(
			"Offline",
		);
		mocks.fetch.mockResolvedValueOnce(
			Response.json(catalog("Recovered skill")),
		);
		expect((await marketplace.fetchMarketplaceCatalog()).entries[0].name).toBe(
			"Recovered skill",
		);
		expect(mocks.fetch).toHaveBeenCalledTimes(3);
	});

	it("falls back to the static catalog after a sidecar error payload", async () => {
		mocks.resolveBackend.mockResolvedValue("http://localhost:3126");
		mocks.fetch
			.mockResolvedValueOnce(
				Response.json({
					...marketplace.EMPTY_CATALOG,
					error: "upstream unavailable",
				}),
			)
			.mockResolvedValueOnce(Response.json(catalog()));
		const recovered = await marketplace.fetchMarketplaceCatalog();
		expect(recovered.entries[0].name).toBe("Example skill");
		expect(mocks.fetch).toHaveBeenCalledTimes(2);
		expect(mocks.fetch).toHaveBeenNthCalledWith(
			1,
			"http://localhost:3126/api/marketplace/catalog",
			{ headers: { Accept: "application/json" } },
		);
		expect(mocks.fetch).toHaveBeenNthCalledWith(2, "/api/marketplace/catalog", {
			headers: { Accept: "application/json" },
		});
	});
});
