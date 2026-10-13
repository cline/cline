import {
	isChatCompatibleModel,
	ModelInfoSchema,
	type ModelModalities,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	builtinProviderSupportsModelOperation,
	normalizeBuiltinModelOperationModalities,
} from "../providers/model-operations";
import {
	resolveCatalogModelOperation,
	resolveCatalogModelOperationModes,
} from "./model-operation";

describe("audio model classification", () => {
	it.each([
		"whisper-1",
		"gpt-realtime-whisper",
		"gemini-transcribe-live",
	])("classifies audio-only %s as transcription", (id) => {
		const model = { id, modalities: { input: ["audio"], output: ["text"] } };
		expect(resolveCatalogModelOperation(model)).toBe("transcription");
		expect(resolveCatalogModelOperationModes(id, model)).toEqual([
			id === "whisper-1" ? "batch" : "streaming",
		]);
	});

	it.each([
		{ id: "gpt-realtime-2.1" },
		{ id: "gemini-live" },
		{ id: "model", tags: ["websocket-realtime"] },
		{ id: "model", operation: "transcription" as const },
	])("categorizes multimodal $id as unsupported realtime", (identity) => {
		const descriptor = {
			...identity,
			modalities: { input: ["audio", "text", "image"], output: ["text"] },
		};
		const model = ModelInfoSchema.parse({
			...descriptor,
			operation: resolveCatalogModelOperation(descriptor),
			operationModes: resolveCatalogModelOperationModes(
				descriptor.id,
				descriptor,
			),
		});
		expect(model.operation).toBe("realtime");
		expect(model.operationModes).toEqual(["streaming"]);
		expect(isChatCompatibleModel(model)).toBe(false);
		expect(
			builtinProviderSupportsModelOperation({
				...model,
				providerId: "vercel-ai-gateway",
				modelId: model.id,
			}),
		).toBe(false);
	});

	it("keeps ordinary multimodal chat separate from realtime sessions", () => {
		expect(
			resolveCatalogModelOperation({
				id: "chat",
				modalities: { input: ["audio", "text", "image"], output: ["text"] },
			}),
		).toBe("language");
		expect(
			resolveCatalogModelOperation({
				id: "live-chat",
				modalities: { input: ["text"], output: ["text"] },
			}),
		).toBe("language");
	});

	it("does not crop multimodal input into a transcription shape", () => {
		const modalities: ModelModalities = {
			input: ["audio", "text", "image"],
			output: ["text"],
		};
		expect(
			normalizeBuiltinModelOperationModalities({
				providerId: "vercel-ai-gateway",
				modelId: "live",
				operation: "transcription",
				modalities,
			}),
		).toEqual(modalities);
	});
});
