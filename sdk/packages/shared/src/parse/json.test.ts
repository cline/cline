import { describe, expect, it } from "vitest";
import {
	endsInsideJsonString,
	normalizeJsonLikeStringsForSchema,
	parseJsonStream,
} from "./json";

describe("parseJsonStream", () => {
	it("repairs a bare object value into a JSON string", () => {
		const input =
			'{"commands": find /Users/beatrix/dev/sdk -name "user-instruction-config-loader.ts" -o -name "rules.ts" | head -20}';

		expect(parseJsonStream(input)).toEqual({
			commands:
				'find /Users/beatrix/dev/sdk -name "user-instruction-config-loader.ts" -o -name "rules.ts" | head -20',
		});
	});
});

describe("endsInsideJsonString", () => {
	it("detects text cut off inside a string value", () => {
		expect(
			endsInsideJsonString(
				'{"path":"config/database.yml","content":"production:\\n  password: correct-horse-battery-sta',
			),
		).toBe(true);
	});

	it("detects text cut off inside a key", () => {
		expect(endsInsideJsonString('{"path":"a.txt","cont')).toBe(true);
	});

	it("detects text cut off on a trailing escape", () => {
		expect(endsInsideJsonString('{"content":"line1\\')).toBe(true);
	});

	it("accepts complete JSON", () => {
		expect(endsInsideJsonString('{"path":"a.txt","content":"done"}')).toBe(
			false,
		);
	});

	it("accepts truncation at a structural boundary (all strings closed)", () => {
		expect(endsInsideJsonString('{"commands": ["ls"')).toBe(false);
		expect(endsInsideJsonString('{"path":"a.txt",')).toBe(false);
	});

	it("handles escaped quotes inside string values", () => {
		expect(endsInsideJsonString('{"content":"say \\"hi\\""}')).toBe(false);
		expect(endsInsideJsonString('{"content":"say \\"hi')).toBe(true);
	});

	it("ignores braces and quotes nested inside closed strings", () => {
		expect(endsInsideJsonString('{"content":"{\\"inner\\": 1}"}')).toBe(false);
	});

	it("treats single-quoted pseudo-JSON as not string-truncated", () => {
		expect(endsInsideJsonString("{'commands': ['ls']}")).toBe(false);
	});
});

describe("normalizeJsonLikeStringsForSchema", () => {
	it("parses JSON strings when the schema expects arrays", () => {
		expect(
			normalizeJsonLikeStringsForSchema(
				{ commands: JSON.stringify(["git status", "bun test"]) },
				{
					type: "object",
					properties: {
						commands: {
							type: "array",
							items: { type: "string" },
						},
					},
				},
			),
		).toEqual({ commands: ["git status", "bun test"] });
	});

	it("preserves JSON-looking strings when the schema expects strings", () => {
		const text = JSON.stringify({ keep: "as text" });

		expect(
			normalizeJsonLikeStringsForSchema(
				{ text },
				{
					type: "object",
					properties: {
						text: { type: "string" },
					},
				},
			),
		).toEqual({ text });
	});

	it("normalizes nested array items using item schemas", () => {
		expect(
			normalizeJsonLikeStringsForSchema(
				{
					steps: [
						{ args: JSON.stringify(["--version"]) },
						{ args: JSON.stringify(["test"]) },
					],
				},
				{
					type: "object",
					properties: {
						steps: {
							type: "array",
							items: {
								type: "object",
								properties: {
									args: {
										type: "array",
										items: { type: "string" },
									},
								},
							},
						},
					},
				},
			),
		).toEqual({
			steps: [{ args: ["--version"] }, { args: ["test"] }],
		});
	});
});
