import { describe, expect, it } from "vitest";
import { createMcpTools, stripLookaroundPatterns } from "./tools";
import type { McpToolProvider } from "./types";

// Emitted by Zod v4's z.email() (seen in resend-mcp); rejected by OpenAI with
// "Invalid JSON schema: regex lookaround is not supported".
const EMAIL_PATTERN =
	"^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$";

describe("stripLookaroundPatterns", () => {
	it("drops lookaround patterns at any depth while keeping other keywords", () => {
		const schema = {
			type: "object",
			properties: {
				email: {
					type: "string",
					format: "email",
					pattern: EMAIL_PATTERN,
					description: "Contact email address",
				},
				to: {
					type: "array",
					items: { type: "string", format: "email", pattern: EMAIL_PATTERN },
				},
				emails: {
					type: "array",
					items: {
						type: "object",
						properties: {
							cc: { type: "array", items: { pattern: EMAIL_PATTERN } },
						},
					},
				},
				variant: {
					anyOf: [{ type: "string", pattern: "(?<!x)y" }, { type: "null" }],
				},
			},
			required: ["email"],
		};

		expect(stripLookaroundPatterns(schema)).toEqual({
			type: "object",
			properties: {
				email: {
					type: "string",
					format: "email",
					description: "Contact email address",
				},
				to: { type: "array", items: { type: "string", format: "email" } },
				emails: {
					type: "array",
					items: {
						type: "object",
						properties: { cc: { type: "array", items: {} } },
					},
				},
				variant: { anyOf: [{ type: "string" }, { type: "null" }] },
			},
			required: ["email"],
		});
	});

	it("keeps plain patterns and properties that happen to be named pattern", () => {
		const schema = {
			type: "object",
			properties: {
				id: { type: "string", pattern: "^[a-z0-9-]+$" },
				pattern: { type: "string", description: "glob to match" },
			},
		};

		expect(stripLookaroundPatterns(schema)).toEqual(schema);
	});
});

describe("createMcpTools", () => {
	it("exposes MCP tool schemas without lookaround patterns", async () => {
		const provider: McpToolProvider = {
			listTools: async () => [
				{
					name: "create-contact",
					inputSchema: {
						type: "object",
						properties: {
							email: {
								type: "string",
								format: "email",
								pattern: EMAIL_PATTERN,
							},
						},
						required: ["email"],
					},
				},
			],
			callTool: async () => undefined,
		};

		const [tool] = await createMcpTools({ serverName: "resend", provider });
		expect(tool?.inputSchema).toEqual({
			type: "object",
			properties: { email: { type: "string", format: "email" } },
			required: ["email"],
		});
	});
});
