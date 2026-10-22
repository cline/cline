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

	it("repairs single-quoted JSON", () => {
		expect(parseJsonStream("{'commands': ['ls']}")).toEqual({
			commands: ["ls"],
		});
	});

	it("repairs valid JSON with trailing commas", () => {
		expect(parseJsonStream('{"name": "test",}')).toEqual({ name: "test" });
	});

	it("rejects truncated JSON with an unterminated string", () => {
		const truncated = '{"path":"cfg.yml","content":"production:\\n  host: db';
		expect(parseJsonStream(truncated)).toBe(truncated);
	});

	it("repairs Python-style literals into typed JSON values", () => {
		expect(parseJsonStream('{"flag": True}')).toEqual({ flag: true });
		expect(parseJsonStream('{"flag": None}')).toEqual({ flag: null });
	});

	it("repairs bare-object values with literal double quotes", () => {
		expect(parseJsonStream('{"commands": echo \'it"s fine\'}')).toEqual({
			commands: "echo 'it\"s fine'",
		});
	});

	it("repairs bare-object values with unbalanced double quotes in shell commands", () => {
		expect(parseJsonStream('{"commands": grep -c " file.txt}')).toEqual({
			commands: 'grep -c " file.txt',
		});
	});

	it("repairs single-quoted JSON with double-quote characters inside values", () => {
		expect(parseJsonStream("{'commands': ['grep \" foo']}")).toEqual({
			commands: ['grep " foo'],
		});
	});

	it("repairs unclosed containers with complete string values", () => {
		expect(parseJsonStream('{"commands": ["ls"')).toEqual({
			commands: ["ls"],
		});
	});

	it("returns already-valid JSON unchanged", () => {
		expect(parseJsonStream('{"commands": ["ls"]}')).toEqual({
			commands: ["ls"],
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
