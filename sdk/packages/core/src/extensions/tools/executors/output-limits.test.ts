import { describe, expect, it } from "vitest";
import { truncateCommandOutput } from "./output-limits";

describe("truncateCommandOutput", () => {
	it.each([
		["head", "a😀middlezz", "a", "zz"],
		["tail", "aamiddle😀z", "aa", "z"],
		["both", "a😀middle😀z", "a", "z"],
	])("preserves surrogate pairs at the %s cut", (_name, text, head, tail) => {
		const result = truncateCommandOutput(text, { maxChars: 4 });
		expect(Buffer.from(result).toString("utf8")).toBe(result);
		expect(result.startsWith(`${head}\n`)).toBe(true);
		expect(result.endsWith(`\n${tail}`)).toBe(true);
		expect(result).toContain(`${text.length} chars total`);
	});

	it("omits pairs that cannot fit in the head or tail", () => {
		const result = truncateCommandOutput("😀middle😀", { maxChars: 2 });
		expect(result.startsWith("\n[... output truncated:")).toBe(true);
		expect(result.endsWith("]\n")).toBe(true);
		expect(Buffer.from(result).toString("utf8")).toBe(result);
	});

	it("preserves ASCII budgets and recovery guidance", () => {
		expect(truncateCommandOutput("abcdefghi", { maxChars: 5 })).toBe(
			"abc\n[... output truncated: 9 chars total. Refine the command (grep, head, tail) to view the elided middle ...]\nhi",
		);
	});

	it("preserves no-truncation and streamed total behavior", () => {
		expect(truncateCommandOutput("a😀", { maxChars: 3 })).toBe("a😀");
		const result = truncateCommandOutput("a😀z", {
			maxChars: 4,
			totalChars: 100,
		});
		expect(Buffer.from(result).toString("utf8")).toBe(result);
		expect(result).toContain("100 chars total");
	});
});
