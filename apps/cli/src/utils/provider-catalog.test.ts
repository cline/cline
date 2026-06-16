import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	listLocalProviders: vi.fn(async () => ({ providers: [], settingsPath: "" })),
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
	it("passes the Cline Pass feature flag into the SDK provider list", async () => {
		const { listLocalProviders } = await import("./provider-catalog");
		const manager = {} as never;

		await listLocalProviders(manager);

		expect(mocks.getBooleanFlagEnabled).toHaveBeenCalledWith("ext-cline-pass");
		expect(mocks.listLocalProviders).toHaveBeenCalledWith(manager, {
			isClinePassEnabled: true,
		});
	});
});
