import { describe, expect, it } from "vitest";
import { createTool } from "./create";
import { zodToJsonSchema } from "../parse/zod";
import { z } from "zod";

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

	it("strips the $schema meta-key emitted by Zod v4's toJSONSchema", () => {
		// Zod v4 always adds "$schema" to the output of z.toJSONSchema().
		// LLM tool APIs don't need it and some may reject it.
		const schema = z.object({ value: z.string() });
		const tool = createTool({
			name: "zod_schema_tool",
			description: "Tool with a Zod-derived schema",
			inputSchema: zodToJsonSchema(schema),
			execute: async () => ({ ok: true }),
		});

		expect(tool.inputSchema).not.toHaveProperty("$schema");
		expect(tool.inputSchema).toHaveProperty("type", "object");
	});

	it("infers type:object when all anyOf branches are objects", () => {
		// Build the anyOf manually to avoid depending on Zod's output shape.
		const tool = createTool({
			name: "all_object_anyof_tool",
			description: "Tool with all-object anyOf branches",
			inputSchema: {
				anyOf: [
					{ type: "object", properties: { a: { type: "string" } } },
					{ type: "object", properties: { b: { type: "number" } } },
				],
			},
			execute: async () => ({ ok: true }),
		});

		expect(tool.inputSchema).toHaveProperty("type", "object");
	});

	it("throws when inputSchema has a top-level anyOf with non-object branches", () => {
		// A mixed-type union (objects + strings) is not a valid tool input_schema
		// for any major LLM provider.  createTool must reject it at registration
		// time so the bug surfaces immediately rather than at inference time.
		expect(() =>
			createTool({
				name: "bad_union_tool",
				description: "Tool with a mixed-type union schema",
				inputSchema: {
					anyOf: [
						{ type: "object", properties: { commands: { type: "array" } } },
						{ type: "string" },
					],
				},
				execute: async () => ({ ok: true }),
			}),
		).toThrow(/top level/i);
	});

	it("throws when a Zod union schema with non-object branches is passed as inputSchema", () => {
		// The concrete regression: passing a coercion/union schema (e.g.
		// StructuredCommandsInputUnionSchema) directly as inputSchema must fail
		// loudly, not silently forward a broken anyOf to the LLM provider.
		const unionSchema = z.union([
			z.object({ commands: z.array(z.string()) }),
			z.string(),
		]);

		expect(() =>
			createTool({
				name: "union_schema_tool",
				description: "Tool mistakenly using a union as inputSchema",
				inputSchema: zodToJsonSchema(unionSchema),
				execute: async () => ({ ok: true }),
			}),
		).toThrow(/top level/i);
	});
});
