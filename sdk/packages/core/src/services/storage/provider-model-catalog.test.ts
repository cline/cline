import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetClineRecommendedModelsCacheForTests } from "../llms/cline-recommended-models";
import { clearLiveModelsCatalogCache } from "../llms/provider-defaults";
import { ProviderSettingsManager } from "./provider-settings-manager";

const directories: string[] = [];
function settingsPath() {
	const directory = mkdtempSync(join(tmpdir(), "provider-catalog-"));
	directories.push(directory);
	return join(directory, "settings.json");
}
afterEach(() => {
	resetClineRecommendedModelsCacheForTests();
	clearLiveModelsCatalogCache();
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});
function transport() {
	return vi.fn(
		async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
			const name = new Headers(init?.headers).get("X-CLIENT-TYPE");
			return Response.json(
				String(input).includes("recommended-models")
					? {
							recommended: [{ id: `vendor/${name}`, name, tags: [] }],
							free: [{ id: `free/${name}` }],
							clinePass: [],
						}
					: {},
			);
		},
	);
}
describe("ProviderSettingsManager model catalog", () => {
	it("shares the feed with the catalog and sends the configured client through the configured transport", async () => {
		const fetchImpl = transport();
		const client = {
			name: "desktop",
			version: "1.2.3",
			platform: "Desktop",
			isMultiRoot: true,
		};
		const manager = new ProviderSettingsManager({
			filePath: settingsPath(),
			client,
			baseUrl: "https://enterprise.test/api/v1/",
			fetchImpl,
		});
		client.name = "changed-after-construction";
		const [feed] = await Promise.all([
			manager.getRecommendedModels(),
			manager.refreshCatalog(),
			manager.getFreeModelIds(),
		]);
		expect(feed.recommended[0]?.id).toBe("vendor/desktop");
		const requests = fetchImpl.mock.calls.filter(([url]) =>
			String(url).includes("recommended-models"),
		);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.[0]).toBe(
			"https://enterprise.test/api/v1/ai/cline/recommended-models",
		);
		expect(new Headers(requests[0]?.[1]?.headers).get("X-IS-MULTIROOT")).toBe(
			"true",
		);
		expect(new Headers(requests[0]?.[1]?.headers).get("X-CLIENT-VERSION")).toBe(
			"1.2.3",
		);
		expect(manager.peekRecommendedModels()).toEqual(feed);
	});
	it("isolates concurrent requests and caches by client, endpoint, and transport", async () => {
		const fetchImpl = transport();
		const otherFetch = transport();
		const create = (
			name: string,
			baseUrl = "https://one.test",
			fetcher = fetchImpl,
		) =>
			new ProviderSettingsManager({
				filePath: settingsPath(),
				client: { name },
				baseUrl,
				fetchImpl: fetcher,
			});
		const a = create("cli"),
			b = create("desktop"),
			c = create("cli", "https://two.test"),
			d = create("cli", "https://one.test", otherFetch);
		const [aFeed, bFeed] = await Promise.all([
			a.getRecommendedModels(),
			b.getRecommendedModels(),
			c.getRecommendedModels(),
			d.getRecommendedModels(),
		]);
		expect(aFeed.recommended[0]?.id).toBe("vendor/cli");
		expect(bFeed.recommended[0]?.id).toBe("vendor/desktop");
		await Promise.all([
			a.getRecommendedModels(),
			b.getRecommendedModels(),
			c.getRecommendedModels(),
			d.getRecommendedModels(),
		]);
		expect(
			fetchImpl.mock.calls.filter(([url]) =>
				String(url).includes("recommended-models"),
			),
		).toHaveLength(3);
		expect(
			otherFetch.mock.calls.filter(([url]) =>
				String(url).includes("recommended-models"),
			),
		).toHaveLength(1);
	});
	it("uses the updated provider endpoint and does not substitute UI fallbacks for free-cost accounting", async () => {
		const fetchImpl = vi.fn(
			async () => new Response("offline", { status: 503 }),
		);
		const manager = new ProviderSettingsManager({
			filePath: settingsPath(),
			client: { name: "cli" },
			fetchImpl,
		});
		manager.saveProviderSettings({
			provider: "cline",
			baseUrl: "https://first.test",
		});
		expect(await manager.getFreeModelIds()).toEqual([]);
		manager.saveProviderSettings({
			provider: "cline",
			baseUrl: "https://second.test",
		});
		expect(await manager.getFreeModelIds()).toEqual([]);
		expect(fetchImpl).toHaveBeenNthCalledWith(
			2,
			"https://second.test/api/v1/ai/cline/recommended-models",
			expect.anything(),
		);
	});
});
