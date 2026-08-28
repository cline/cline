import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type ChatModelModalities,
	isChatCompatibleModel,
	ONE_TIME_SCHEDULE_CRON_PATTERN,
	ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY,
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

	it("exports the one-time schedule contract", () => {
		expect(ONE_TIME_SCHEDULE_CRON_PATTERN).toBe("0");
		expect(ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY).toBe(
			"__hubScheduleRunAt",
		);
	});
});
