import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "./provider-schema";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: invokeMock },
}));

import {
	clearProviderModelCatalogCache,
	loadProviderModelCatalog,
	primeProviderModelCatalog,
} from "./provider-model-catalog";

const provider: Provider = {
	id: "test",
	name: "Test",
	models: 1,
	color: "#fff",
	letter: "T",
	enabled: true,
	modelList: [{ id: "fast", name: "Fast", supportsReasoning: true }],
};

beforeEach(() => {
	clearProviderModelCatalogCache();
	invokeMock.mockReset();
});

describe("provider model catalog cache", () => {
	it("deduplicates concurrent loads and reuses the warm catalog", async () => {
		invokeMock.mockResolvedValue({ providers: [provider], settingsPath: "" });

		const [first, second] = await Promise.all([
			loadProviderModelCatalog(),
			loadProviderModelCatalog(),
		]);
		const third = await loadProviderModelCatalog();

		expect(invokeMock).toHaveBeenCalledTimes(1);
		expect(first).toBe(second);
		expect(second).toBe(third);
		expect(first.enabledProviderIds).toEqual(["test"]);
		expect(first.providerReasoningModels).toEqual({ test: ["fast"] });
	});

	it("lets settings updates prime the shared cache", async () => {
		primeProviderModelCatalog([{ ...provider, enabled: false }]);

		const result = await loadProviderModelCatalog();

		expect(invokeMock).not.toHaveBeenCalled();
		expect(result.enabledProviderIds).toEqual([]);
	});

	it("supports an explicit refresh", async () => {
		primeProviderModelCatalog([provider]);
		invokeMock.mockResolvedValue({
			providers: [{ ...provider, enabled: false }],
			settingsPath: "",
		});

		const result = await loadProviderModelCatalog({ force: true });

		expect(invokeMock).toHaveBeenCalledTimes(1);
		expect(result.enabledProviderIds).toEqual([]);
	});
});
