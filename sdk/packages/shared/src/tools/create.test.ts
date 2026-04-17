import { describe, expect, it } from "vitest";
import { createTool } from "./create";

describe("createTool", () => {
	it("adds a top-level object type for raw object-like JSON schemas", () => {
		const tool = createTool({
			name: "raw_schema_tool",
			description: "Tool with a raw object-like schema",
			inputSchema: {
				properties: {
					value: {
						type: "string",
					},
				},
				required: ["value"],
				additionalProperties: false,
			},
			execute: async () => ({ ok: true }),
		});

		expect(tool.inputSchema).toEqual({
			type: "object",
			properties: {
				value: {
					type: "string",
				},
			},
			required: ["value"],
			additionalProperties: false,
		});
	});
});
