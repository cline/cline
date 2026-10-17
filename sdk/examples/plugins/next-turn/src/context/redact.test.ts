import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { clip, redactSecrets } from "./redact";

/** Golden redaction outputs, frozen in `test-fixtures/redaction.json`. */
const redactionFixture = JSON.parse(
	readFileSync(
		new URL("../../test-fixtures/redaction.json", import.meta.url),
		"utf8",
	),
) as {
	cases: { sample: string; expected: string }[];
};

describe("redaction", () => {
	test("matches the frozen redaction outputs", () => {
		for (const fixture of redactionFixture.cases)
			expect(redactSecrets(fixture.sample)).toBe(fixture.expected);
	});

	test("clip redacts, collapses whitespace and bounds the length", () => {
		expect(clip("a  sk-abcdefghijklmnopqrstuv\n b", 80)).toBe("a [redacted] b");
		expect(clip("x".repeat(20), 10)).toBe(`${"x".repeat(9)}…`);
	});
});
