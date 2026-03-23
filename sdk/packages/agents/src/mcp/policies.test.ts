import { describe, expect, it } from "vitest";
import {
	createDisabledMcpToolPolicies,
	createDisabledMcpToolPolicy,
} from "./policies.js";

describe("mcp policy helpers", () => {
	it("creates a disabled policy for a single MCP tool", () => {
		expect(
			createDisabledMcpToolPolicy({
				serverName: "docs",
				toolName: "search",
			}),
		).toEqual({
			docs__search: {
				enabled: false,
			},
		});
	});

	it("creates disabled policies for multiple MCP tools", () => {
		expect(
			createDisabledMcpToolPolicies({
				serverName: "docs",
				toolNames: ["search", "read"],
			}),
		).toEqual({
			docs__search: {
				enabled: false,
			},
			docs__read: {
				enabled: false,
			},
		});
	});

	it("respects custom MCP tool name transforms", () => {
		expect(
			createDisabledMcpToolPolicy({
				serverName: "docs",
				toolName: "search",
				nameTransform: ({ serverName, toolName }) =>
					`mcp:${serverName}:${toolName}`,
			}),
		).toEqual({
			"mcp:docs:search": {
				enabled: false,
			},
		});
	});

	it("uses the sanitized default MCP tool name policy for invalid server names", () => {
		expect(
			createDisabledMcpToolPolicy({
				serverName: "github.com/cline/linear-mcp",
				toolName: "list_issues",
			}),
		).toEqual({
			"github_com_cline_linear-mcp__list_issues_6a40079f": {
				enabled: false,
			},
		});
	});
});
