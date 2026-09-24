import { describe, expect, it, vi } from "vitest";
import { loadCloudModels } from "./models";

describe("loadCloudModels", () => {
	it.each([
		[" https://api.example.test/// \n", "https://api.example.test"],
		[
			`https://api.example.test${"/".repeat(40_000)}`,
			"https://api.example.test",
		],
		[
			`https://api.example.test/${"/".repeat(40_000)}path/`,
			`https://api.example.test/${"/".repeat(40_000)}path`,
		],
	])("normalizes the catalog base URL (case %#)", async (input, expected) => {
		const fetcher = vi.fn(
			async (_url: string) => new Response(JSON.stringify([])),
		);
		await expect(
			loadCloudModels(input, { fetchImpl: fetcher as unknown as typeof fetch }),
		).resolves.toEqual([]);
		expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
			`${expected}/api/v1/ai/cline/models`,
			`${expected}/api/v1/ai/cline/recommended-models`,
		]);
	});
	it("includes cloud-only recommendations and unrecommended catalog models", async () => {
		const fetcher = vi.fn(
			async (url: string) =>
				new Response(
					JSON.stringify(
						url.endsWith("/models")
							? { data: [{ id: "local-model", display_name: "Local model" }] }
							: { data: { clineCloud: [{ id: "recommended" }] } },
					),
				),
		);
		const models = await loadCloudModels("https://api.example.test/", {
			fetchImpl: fetcher as unknown as typeof fetch,
		});
		expect(models).toEqual([
			{ id: "recommended", name: "recommended", catalogId: "cline-cloud" },
			{ id: "local-model", name: "Local model", catalogId: "cline" },
		]);
	});
	it.each([
		false,
		true,
	])("filters Pass before deduplicating (organization: %s)", async (isOrganizationSession) => {
		const fetcher = vi.fn(
			async (url: string) =>
				new Response(
					JSON.stringify(
						url.endsWith("/models")
							? [{ id: "model" }]
							: { clinePass: [{ id: "model" }, { id: "pass-only" }] },
					),
				),
		);
		const models = await loadCloudModels("https://api.example.test", {
			isOrganizationSession,
			fetchImpl: fetcher as unknown as typeof fetch,
		});
		expect(models).toEqual(
			isOrganizationSession
				? [{ id: "model", name: "model", catalogId: "cline" }]
				: [
						{ id: "model", name: "model", catalogId: "cline-pass" },
						{ id: "pass-only", name: "pass-only", catalogId: "cline-pass" },
					],
		);
	});
	it.each([
		"/models",
		"/recommended-models",
	])("fails closed if %s is unavailable, without returning a partial inventory", async (failedPath) => {
		const fetcher = vi.fn(async (url: string) =>
			url.endsWith(failedPath)
				? new Response("unavailable", { status: 503 })
				: Response.json([{ id: "model" }]),
		);
		await expect(
			loadCloudModels("https://api.example.test", {
				fetchImpl: fetcher as unknown as typeof fetch,
			}),
		).rejects.toThrow("cloud model catalog");
	});
});
