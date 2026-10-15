import type { GatewayProviderManifest } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	providerManifestSupportsModelTool,
	providerOffersModelTool,
	supportsModelTool,
} from "./model-tools";

describe("supportsModelTool", () => {
	it.each([
		["cline", undefined],
		["cline-pass", undefined],
		["anthropic", undefined],
		["openai-native", undefined],
		["openai-codex", undefined],
		["gemini", undefined],
		["vertex", "gemini-3.1-pro-preview"],
	])("supports native web search for %s / %s", (providerId, modelId) => {
		expect(supportsModelTool({ providerId, modelId }, "web_search")).toBe(true);
	});

	it("normalizes aliases before resolving support", () => {
		expect(
			supportsModelTool(
				{ providerId: "openai-compatible", modelId: "custom" },
				"web_search",
			),
		).toBe(false);
		// "openai" is an alias for "openai-compatible", not native OpenAI.
		expect(supportsModelTool({ providerId: "openai" }, "web_search")).toBe(
			false,
		);
	});

	it("offers OpenAI image generation to language models, not dedicated image operations", () => {
		expect(
			supportsModelTool(
				{ providerId: "openai-native", modelId: "gpt-5.4" },
				"image_generation",
			),
		).toBe(true);
		expect(
			supportsModelTool(
				{ providerId: "openai-native", modelId: "gpt-image-2" },
				"image_generation",
			),
		).toBe(false);
		expect(
			supportsModelTool(
				{ providerId: "openai", modelId: "gpt-5.4" },
				"image_generation",
			),
		).toBe(false);
	});

	it("excludes known and unregistered Claude routes from Vertex", () => {
		expect(
			supportsModelTool(
				{ providerId: "vertex", modelId: "claude-sonnet-4-6" },
				"web_search",
			),
		).toBe(false);
		expect(
			supportsModelTool(
				{ providerId: "vertex", modelId: "claude-custom" },
				"web_search",
			),
		).toBe(false);
	});

	it("resolves custom provider support from manifest metadata", () => {
		const manifest = {
			id: "custom",
			name: "Custom",
			defaultModelId: "alpha",
			models: [{ id: "alpha", name: "Alpha", providerId: "custom" }],
			modelToolCapabilities: [{ name: "web_search" }],
		} satisfies GatewayProviderManifest;

		expect(
			providerManifestSupportsModelTool(manifest, "alpha", "web_search"),
		).toBe(true);
	});

	it("reports provider-level availability independent of model routes", () => {
		// Vertex excludes Claude routes per model but still offers web search.
		expect(providerOffersModelTool("vertex", "web_search")).toBe(true);
		expect(providerOffersModelTool("anthropic", "web_search")).toBe(true);
		expect(providerOffersModelTool("openrouter", "web_search")).toBe(false);
		expect(providerOffersModelTool("unknown-custom", "web_search")).toBe(false);
	});

	it("falls back to the manifest default model when no model id is given", () => {
		const manifest = {
			id: "custom",
			name: "Custom",
			defaultModelId: "excluded",
			models: [
				{ id: "excluded", name: "Excluded", providerId: "custom" },
				{ id: "allowed", name: "Allowed", providerId: "custom" },
			],
			modelToolCapabilities: [
				{
					name: "web_search",
					excludeRoutes: [{ matcher: "model-id", modelId: "excluded" }],
				},
			],
		} satisfies GatewayProviderManifest;

		expect(
			providerManifestSupportsModelTool(manifest, undefined, "web_search"),
		).toBe(false);
		expect(
			providerManifestSupportsModelTool(manifest, "allowed", "web_search"),
		).toBe(true);
	});
});
