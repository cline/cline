import { describe, expect, it, vi } from "vitest";

type MockProviderCatalog = {
	providers: Array<{ id: string; name: string }>;
	settingsPath: string;
};

const mocks = vi.hoisted(() => ({
	listLocalProviders: vi.fn(
		async (): Promise<MockProviderCatalog> => ({
			providers: [],
			settingsPath: "",
		}),
	),
	getBooleanFlagEnabled: vi.fn(() => true),
}));

vi.mock("@cline/core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@cline/core")>();
	return {
		...actual,
		listLocalProviders: mocks.listLocalProviders,
	};
});

vi.mock("./feature-flags", () => ({
	getCliFeatureFlagsService: () => ({
		getBooleanFlagEnabled: mocks.getBooleanFlagEnabled,
	}),
}));

describe("listLocalProviders", () => {
	it("passes the ClinePass feature flag into the SDK provider list", async () => {
		const { listLocalProviders } = await import("./provider-catalog");
		const manager = {} as never;

		await listLocalProviders(manager);

		expect(mocks.getBooleanFlagEnabled).toHaveBeenCalledWith("ext-cline-pass");
		expect(mocks.listLocalProviders).toHaveBeenCalledWith(manager, {
			isClinePassEnabled: true,
		});
	});

	it("maps the Cline provider to the CLI display name", async () => {
		mocks.listLocalProviders.mockResolvedValueOnce({
			settingsPath: "",
			providers: [
				{ id: "cline", name: "Cline" },
				{ id: "cline-pass", name: "ClinePass" },
			],
		});
		const { listLocalProviders } = await import("./provider-catalog");

		await expect(listLocalProviders({} as never)).resolves.toMatchObject({
			providers: [
				{ id: "cline", name: "Cline Usage-Billing" },
				{ id: "cline-pass", name: "ClinePass" },
			],
		});
	});
});
