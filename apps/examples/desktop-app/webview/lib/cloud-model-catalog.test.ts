import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCloudModelCatalog } from "./cloud-model-catalog";

const { invoke, loadProviderModels } = vi.hoisted(() => ({
	invoke: vi.fn(),
	loadProviderModels: vi.fn(),
}));
vi.mock("@/lib/desktop-client", () => ({ desktopClient: { invoke } }));
vi.mock("@/lib/provider-model-catalog", () => ({ loadProviderModels }));

beforeEach(() => {
	invoke.mockReset();
	loadProviderModels.mockReset().mockResolvedValue([]);
});

describe("cloud model catalog", () => {
	it("uses cloud availability and labels while retaining image/reasoning capabilities", async () => {
		invoke.mockResolvedValue([
			{ id: "paid", name: "Usage model", catalogId: "cline" },
			{ id: "cline-pass/pass", name: "Subscribed", catalogId: "cline-pass" },
			{ id: "cline-cloud/free", name: "Free", catalogId: "cline-cloud" },
		]);
		loadProviderModels.mockImplementation(async (provider) =>
			provider === "cline"
				? [
						{
							id: "paid",
							name: "Local label",
							inputModalities: ["text", "image"],
						},
						{ id: "local-only", name: "Local only" },
					]
				: [{ id: "cline-pass/pass", name: "Pass", supportsReasoning: true }],
		);
		expect(await loadCloudModelCatalog()).toEqual([
			{
				id: "paid",
				name: "Usage model",
				catalogId: "cline",
				inputModalities: ["text", "image"],
			},
			{
				id: "cline-pass/pass",
				name: "Subscribed",
				catalogId: "cline-pass",
				supportsReasoning: true,
			},
			{ id: "cline-cloud/free", name: "Free", catalogId: "cline-cloud" },
		]);
		expect(invoke).toHaveBeenCalledWith("list_cloud_models");
	});

	it("does not offer local Pass models excluded by the account-scoped catalog", async () => {
		invoke.mockResolvedValue([
			{ id: "paid", name: "Paid", catalogId: "cline" },
		]);
		loadProviderModels.mockResolvedValue([
			{ id: "cline-pass/pass", name: "Pass" },
		]);
		expect(await loadCloudModelCatalog()).toEqual([
			{ id: "paid", name: "Paid", catalogId: "cline" },
		]);
	});

	it("tolerates unavailable capability metadata but propagates cloud catalog failures", async () => {
		const models = [{ id: "free", name: "Free", catalogId: "cline-cloud" }];
		invoke.mockResolvedValue(models);
		loadProviderModels.mockRejectedValue(new Error("metadata offline"));
		expect(await loadCloudModelCatalog()).toEqual(models);
		invoke.mockRejectedValue(new Error("catalog offline"));
		await expect(loadCloudModelCatalog()).rejects.toThrow("catalog offline");
	});
});
