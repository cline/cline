import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Llms, ProviderSettingsManager } from "@cline/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveProviderKnownModels } from "./provider-known-models";

const CUSTOM_PROVIDER_ID = "test-custom-proxy";

describe("resolveProviderKnownModels", () => {
	let tempDir: string;
	let manager: ProviderSettingsManager;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "cline-known-models-"));
		manager = new ProviderSettingsManager({
			filePath: join(tempDir, "providers.json"),
		});
	});

	afterEach(() => {
		Llms.unregisterProvider(CUSTOM_PROVIDER_ID);
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("lists the chat models of a custom provider registered from models.json", async () => {
		Llms.registerProvider({
			provider: {
				id: CUSTOM_PROVIDER_ID,
				name: "Test Custom Proxy",
				protocol: "openai-chat",
				client: "openai-compatible",
				baseUrl: "http://127.0.0.1:9/v1",
				defaultModelId: "model-a",
				source: "file",
			},
			models: {
				"model-a": { id: "model-a", name: "Model A", operation: "language" },
				"model-b": { id: "model-b", name: "Model B", operation: "language" },
				"image-c": {
					id: "image-c",
					name: "Image C",
					operation: "image-generation",
				},
			},
		});

		const knownModels = await resolveProviderKnownModels(
			manager,
			CUSTOM_PROVIDER_ID,
		);

		expect(Object.keys(knownModels ?? {}).sort()).toEqual([
			"model-a",
			"model-b",
		]);
	});

	it("returns undefined for a provider that is neither built in nor registered", async () => {
		await expect(
			resolveProviderKnownModels(manager, CUSTOM_PROVIDER_ID),
		).resolves.toBeUndefined();
	});
});
