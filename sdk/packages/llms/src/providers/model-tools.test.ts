import type { GatewayProviderManifest } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	providerManifestSupportsModelTool,
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

	it("excludes known, default, and unregistered Claude routes from Vertex", () => {
		expect(
			supportsModelTool(
				{ providerId: "vertex", modelId: "claude-sonnet-4-6" },
				"web_search",
			),
		).toBe(false);
		expect(supportsModelTool({ providerId: "vertex" }, "web_search")).toBe(
			false,
		);
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
});
