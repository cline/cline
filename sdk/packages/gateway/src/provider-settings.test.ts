import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GatewayProviderSettingsStore } from "./provider-settings";
import { tempDataRoot } from "./test-support";

function createStore() {
	const filePath = join(
		tempDataRoot("gateway-provider-settings-"),
		"providers.json",
	);
	return { filePath, store: new GatewayProviderSettingsStore({ filePath }) };
}

describe("GatewayProviderSettingsStore", () => {
	it("preserves credentials across partial patches without returning them", () => {
		const { filePath, store } = createStore();
		store.patch("anthropic", {
			enabled: true,
			settings: {
				apiKey: "sk-gateway-secret",
				baseUrl: "https://first.example.test",
			},
		});

		const updated = store.patch("anthropic", {
			settings: { baseUrl: "https://second.example.test" },
		});

		expect(updated).toMatchObject({
			providerId: "anthropic",
			enabled: true,
			credentials: { apiKey: true },
			settings: { baseUrl: "https://second.example.test" },
		});
		expect(JSON.stringify(updated)).not.toContain("sk-gateway-secret");
		expect(readFileSync(filePath, "utf8")).toContain("sk-gateway-secret");

		expect(store.patch("anthropic", { enabled: false }).enabled).toBe(false);
		expect(readFileSync(filePath, "utf8")).toContain("sk-gateway-secret");
		expect(store.patch("anthropic", { enabled: true }).credentials.apiKey).toBe(
			true,
		);
	});

	it("clears only explicitly cleared settings", () => {
		const { filePath, store } = createStore();
		writeFileSync(
			filePath,
			JSON.stringify({
				version: 1,
				providers: {
					openrouter: {
						enabled: true,
						settings: {
							provider: "openrouter",
							apiKey: "keep-until-cleared",
							baseUrl: "https://openrouter.example.test",
						},
					},
				},
			}),
		);

		const updated = store.patch("openrouter", {
			settings: { apiKey: "" },
		});
		expect(updated.credentials.apiKey).toBe(false);
		expect(updated.settings).toMatchObject({
			baseUrl: "https://openrouter.example.test",
		});
		expect(readFileSync(filePath, "utf8")).not.toContain("keep-until-cleared");
	});

	it("owns custom provider definitions and model selection", async () => {
		const { store } = createStore();
		const providerId = `gateway-test-${process.pid}`;
		await store.add({
			providerId,
			name: "Gateway Test",
			baseUrl: "https://models.example.test/v1",
			apiKey: "custom-provider-secret",
			models: ["model-b", "model-a"],
			defaultModelId: "model-b",
			capabilities: ["tools", "reasoning"],
		});

		expect(await store.models(providerId)).toMatchObject({
			providerId,
			models: [{ id: "model-a" }, { id: "model-b" }],
		});
		expect(
			await store.updateModels({
				providerId,
				models: ["model-c"],
				defaultModelId: "model-c",
			}),
		).toEqual({ providerId, modelsCount: 1 });
		expect(await store.models(providerId)).toMatchObject({
			models: [{ id: "model-c" }],
		});

		const catalog = await store.catalog();
		const provider = catalog.providers.find((item) => item.id === providerId);
		expect(provider).toMatchObject({
			name: "Gateway Test",
			enabled: true,
			defaultModelId: "model-c",
			models: 1,
		});
		expect(JSON.stringify(provider)).not.toContain("custom-provider-secret");
	});
});
