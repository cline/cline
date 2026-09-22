import { describe, expect, it, vi } from "vitest";
import { loadCloudHandoffModels } from "./model-catalog";
import { selectCloudHandoffModel } from "./model-selection";

describe("handoff live model catalog", () => {
	it("keeps a supported local model even when it is absent from recommendations", async () => {
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
		const models = await loadCloudHandoffModels(
			"https://api.example.test/",
			fetcher as unknown as typeof fetch,
		);
		expect(
			selectCloudHandoffModel({
				localModelId: "local-model",
				models,
				isOrganizationSession: false,
			}),
		).toMatchObject({ modelId: "local-model", usedFallback: false });
	});
	it("keeps the organization catalog entry when the same model is also a personal pass recommendation", async () => {
		const fetcher = vi.fn(
			async (url: string) =>
				new Response(
					JSON.stringify(
						url.endsWith("/models")
							? [{ id: "model" }]
							: { clinePass: [{ id: "model" }] },
					),
				),
		);
		const models = await loadCloudHandoffModels(
			"https://api.example.test",
			fetcher as unknown as typeof fetch,
		);
		expect(
			selectCloudHandoffModel({
				localModelId: "model",
				models,
				isOrganizationSession: true,
			}),
		).toMatchObject({ modelId: "model", catalogId: "cline" });
	});
	it("fails closed if the live catalog is unavailable, without using stale recommendations", async () => {
		const fetcher = vi.fn(
			async () => new Response("unavailable", { status: 503 }),
		);
		await expect(
			loadCloudHandoffModels(
				"https://api.example.test",
				fetcher as unknown as typeof fetch,
			),
		).rejects.toThrow("cloud model catalog");
	});
});
