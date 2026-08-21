import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type ChatModelModalities,
	CONFIGURABLE_MODEL_TOOL_NAMES,
	type ConfigurableModelToolName,
	isChatCompatibleModel,
	type ModelToolSetting,
	type ModelToolSettings,
	supportsChatModalities,
} from "./index.browser";

describe("browser entry point", () => {
	it("exports the chat-model modality API", () => {
		const modalities: ChatModelModalities = {
			input: ["text"],
			output: ["text"],
		};

		expectTypeOf(modalities).toMatchTypeOf<ChatModelModalities>();
		expect(supportsChatModalities(modalities)).toBe(true);
		expect(isChatCompatibleModel({ operation: "transcription" })).toBe(false);
	});

	it("keeps the deprecated model-tool settings exports published in 0.0.77", () => {
		expect(CONFIGURABLE_MODEL_TOOL_NAMES).toEqual(["web_search"]);

		const name: ConfigurableModelToolName = "web_search";
		const setting: ModelToolSetting = { enabled: true };
		const settings: ModelToolSettings = { [name]: setting };

		expectTypeOf(settings).toMatchTypeOf<ModelToolSettings>();
		expect(settings.web_search?.enabled).toBe(true);
	});
});
