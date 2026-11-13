import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type ChatModelModalities,
	FACTORY_PRIORITIES,
	FACTORY_PRIORITY_LABEL,
	factoryPriorityRank,
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

	it("exports the priority labels and order", () => {
		expect(FACTORY_PRIORITIES).toEqual(["urgent", "high", "medium", "low"]);
		expect(FACTORY_PRIORITY_LABEL.none).toBe("No priority");
		expect(factoryPriorityRank({})).toBe(2);
	});
});
