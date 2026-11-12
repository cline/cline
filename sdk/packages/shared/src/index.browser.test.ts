import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type ChatModelModalities,
	formatFactoryId,
	isChatCompatibleModel,
	parseFactoryId,
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
});

describe("browser entry point Factory ids", () => {
	it("exports the short card id helpers", () => {
		expect(formatFactoryId(7)).toBe("F7");
		expect(parseFactoryId("#7")).toBe(7);
	});
});
