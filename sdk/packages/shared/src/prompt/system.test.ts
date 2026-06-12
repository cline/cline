import { describe, expect, it } from "vitest";
import {
	DEFAULT_CLINE_SYSTEM_PROMPT,
	YOLO_CLINE_SYSTEM_PROMPT,
} from "./system";

describe("Cline system prompts", () => {
	it("tell the model to issue independent tool calls together", () => {
		for (const prompt of [
			DEFAULT_CLINE_SYSTEM_PROMPT,
			YOLO_CLINE_SYSTEM_PROMPT,
		]) {
			expect(prompt).toContain(
				"You can call multiple tools in a single response",
			);
			expect(prompt).toContain(
				"When tool calls are independent and do not require each other's results",
			);
			expect(prompt).toContain(
				"Do not split independent reads, searches, or checks across separate turns",
			);
		}
	});
});
