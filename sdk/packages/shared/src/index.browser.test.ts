import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type ChatModelModalities,
	isChatCompatibleModel,
	supportsChatModalities,
	SideVisibleContextSchema,
	SIDE_EXCERPT_BUDGET_BYTES,
	referenceExcerpt,
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
	it("bounds side-context excerpts using the browser contract", () => {
		const clipped = referenceExcerpt("語".repeat(3000));
		const context = {
			sessionId: "parent",
			environmentId: "local",
			capturedAt: "2026-10-28T00:00:00Z",
			excerpts: [
				{
					messageId: "message",
					role: "user",
					text: clipped.text,
					submission: "observed",
					omittedBytes: clipped.omittedBytes,
				},
			],
			omittedExcerptCount: 0,
			omittedMediaCount: 0,
		};
		expect(clipped.omittedBytes).toBeGreaterThan(0);
		expect(clipped.text).not.toContain("�");
		expect(SideVisibleContextSchema.safeParse(context).success).toBe(true);
		context.excerpts[0].text = "a".repeat(SIDE_EXCERPT_BUDGET_BYTES + 1);
		expect(SideVisibleContextSchema.safeParse(context).success).toBe(false);
	});
});
