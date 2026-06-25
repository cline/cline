import { describe, expect, it } from "vitest";
import { normalizeJsonLikeStringsForSchema, parseJsonStream } from "./json";

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
