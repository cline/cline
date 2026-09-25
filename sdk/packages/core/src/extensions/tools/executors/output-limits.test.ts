import { sanitizeSurrogates } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	MAX_COMMAND_OUTPUT_CHARS,
	truncateCommandOutput,
} from "./output-limits";

describe("truncateCommandOutput", () => {
	it("returns output at or below the cap untouched", () => {
		expect(truncateCommandOutput("short output")).toBe("short output");
		expect(truncateCommandOutput("x".repeat(100), { maxChars: 100 })).toBe(
			"x".repeat(100),
		);
	});

	it("elides the middle and leaves the notice in the preserved head", () => {
		const text = "h".repeat(200) + "m".repeat(200) + "t".repeat(200);
		const out = truncateCommandOutput(text, { maxChars: 100 });
		expect(out).toContain("output truncated: 600 chars total");
		expect(out).toContain("Refine the command (grep, head, tail)");
		expect(out.startsWith("h")).toBe(true);
		expect(out.endsWith("t")).toBe(true);
	});

	it("reports the pre-truncation length when the stream was already capped", () => {
		const out = truncateCommandOutput("x".repeat(500), {
			maxChars: 100,
			totalChars: 900,
		});
		expect(out).toContain("900 chars total");
	});

	it("never splits a surrogate pair at either cut", () => {
		const text = "\u{1F3AE}".repeat(5_000);
		// The two cuts move independently with the cap, so cover both parities:
		// an odd head limit and an odd tail limit are where a raw slice splits a
		// character in half.
		for (const maxChars of [1_000, 1_001, 1_002, 1_003]) {
			const out = truncateCommandOutput(text, { maxChars });
			expect(out).toContain("output truncated");
			// The elided content is capped; the notice explaining it is additive.
			expect(out.length).toBeLessThanOrEqual(maxChars + 200);
			expect(out.length).toBeLessThan(MAX_COMMAND_OUTPUT_CHARS);
			expect(sanitizeSurrogates(out)).toBe(out);
			expect(Buffer.from(out, "utf8").toString("utf8")).toBe(out);
		}
	});
});
