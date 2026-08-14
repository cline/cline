import type { GatewayProviderManifest } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	builtinProviderSupportsModelOperation,
	normalizeBuiltinModelOperationModalities,
	providerManifestSupportsModelOperation,
} from "./model-operations";

describe("model operation capabilities", () => {
	it("routes verified native image transports and fails closed for aliases", () => {
		const imageModel = {
			modelId: "gpt-image-2",
			operation: "image-generation" as const,
			modalities: { input: ["text"] as const, output: ["image"] as const },
		};

		expect(
			builtinProviderSupportsModelOperation({
				providerId: "openai-native",
				...imageModel,
			}),
		).toBe(true);
		expect(
			builtinProviderSupportsModelOperation({
				providerId: "openai",
				...imageModel,
			}),
		).toBe(false);
		expect(
			builtinProviderSupportsModelOperation({
				providerId: "openai-compatible",
				...imageModel,
			}),
		).toBe(false);
	});

	it("does not infer a DashScope image endpoint from Qwen model metadata", () => {
		expect(
			builtinProviderSupportsModelOperation({
				providerId: "alibaba-token-plan",
				modelId: "qwen-image-2.0-pro",
				operation: "image-generation",
				modalities: { input: ["text"], output: ["image"] },
				family: "qwen-image",
			}),
		).toBe(false);
	});

	it("constrains catalog modalities to the executable transport subset", () => {
		const modalities = normalizeBuiltinModelOperationModalities({
			providerId: "xai",
			modelId: "grok-imagine-image",
			operation: "image-generation",
			modalities: {
				input: ["text", "image", "pdf"],
				output: ["image", "pdf"],
			},
			family: "grok",
		});

		expect(modalities).toEqual({
			input: ["text", "image"],
			output: ["image"],
		});
		expect(
			builtinProviderSupportsModelOperation({
				providerId: "xai",
				modelId: "grok-imagine-image",
				operation: "image-generation",
				modalities,
				family: "grok",
			}),
		).toBe(true);
	});

	it("keeps ordinary text language models available without a special transport", () => {
		expect(
			builtinProviderSupportsModelOperation({
				providerId: "custom-compatible",
				modelId: "chat-model",
				operation: "language",
				modalities: { input: ["text"], output: ["text"] },
			}),
		).toBe(true);
	});

	it("does not reject supported language output because the model accepts additional inputs", () => {
		expect(
			builtinProviderSupportsModelOperation({
				providerId: "gemini",
				modelId: "gemini-image-with-pdf-input",
				operation: "language",
				modalities: {
					input: ["text", "image", "pdf"],
					output: ["text", "image"],
				},
			}),
		).toBe(true);
	});

	it("resolves custom operations from manifest capabilities", () => {
		const manifest = {
			id: "custom-media",
			name: "Custom Media",
			defaultModelId: "artist",
			models: [
				{
					id: "artist",
					name: "Artist",
					providerId: "custom-media",
					operation: "image-generation",
					modalities: { input: ["text"], output: ["image"] },
				},
			],
			modelOperationCapabilities: [
				{
					operation: "image-generation",
					inputModalities: ["text"],
					outputModalities: ["image"],
				},
			],
		} satisfies GatewayProviderManifest;

		expect(
			providerManifestSupportsModelOperation(manifest, manifest.models[0]),
		).toBe(true);
	});
});
