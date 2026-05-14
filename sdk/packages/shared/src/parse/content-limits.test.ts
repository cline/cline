import { describe, expect, it } from "vitest";
import {
	MAX_TOOL_OUTPUT_CHARS,
	truncateToolOutput,
} from "./content-limits";

describe("truncateToolOutput", () => {
	it("returns input unchanged when at or below the limit", () => {
		expect(truncateToolOutput("command output")).toBe("command output");
	});

	it("preserves both ends and inserts a marker when oversized", () => {
		const head = `HEAD-MARKER-${"a".repeat(1000)}`;
		const middle = "m".repeat(MAX_TOOL_OUTPUT_CHARS);
		const tail = `${"z".repeat(1000)}-TAIL-MARKER`;
		const truncated = truncateToolOutput(head + middle + tail);

		expect(truncated).toContain("HEAD-MARKER-");
		expect(truncated).toContain("-TAIL-MARKER");
		expect(truncated).toContain("[OUTPUT TRUNCATED:");
	});

	it("caps a 24 MB output well under 1 MB", () => {
		const huge = "x".repeat(24 * 1024 * 1024);
		const truncated = truncateToolOutput(huge);
		expect(truncated.length).toBeLessThan(1 * 1024 * 1024);
	});

	it("is a no-op for non-string input", () => {
		const notAString = undefined as unknown as string;
		expect(truncateToolOutput(notAString)).toBe(notAString);
	});

	it("respects a custom maxSize", () => {
		const oversized = "y".repeat(2000);
		const truncated = truncateToolOutput(oversized, 500);
		expect(truncated.length).toBeLessThan(oversized.length);
		expect(truncated).toContain("[OUTPUT TRUNCATED:");
	});
});
