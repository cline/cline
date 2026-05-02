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

	it("applies default execution policy fields", () => {
		const tool = createTool({
			name: "defaulted_tool",
			description: "Tool with default execution policy",
			inputSchema: { type: "object" },
			execute: async () => ({ ok: true }),
		});

		expect(tool.timeoutMs).toBe(30_000);
		expect(tool.retryable).toBe(true);
		expect(tool.maxRetries).toBe(3);
	});

	it("preserves explicit execution policy fields", () => {
		const tool = createTool({
			name: "custom_policy_tool",
			description: "Tool with custom execution policy",
			inputSchema: { type: "object" },
			timeoutMs: 1_000,
			retryable: false,
			maxRetries: 0,
			execute: async () => ({ ok: true }),
		});

		expect(tool.timeoutMs).toBe(1_000);
		expect(tool.retryable).toBe(false);
		expect(tool.maxRetries).toBe(0);
	});
});
