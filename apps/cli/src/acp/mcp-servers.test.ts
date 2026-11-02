import type { McpServer } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { toMcpServerRegistrations } from "./mcp-servers";

describe("toMcpServerRegistrations", () => {
	it("returns no registrations when the client sends none", () => {
		expect(toMcpServerRegistrations(undefined)).toEqual([]);
		expect(toMcpServerRegistrations([])).toEqual([]);
	});

	it("maps http servers to streamableHttp registrations", () => {
		const servers: McpServer[] = [
			{
				type: "http",
				name: "pandacode",
				url: "http://127.0.0.1:50843/mcp",
				headers: [{ name: "Authorization", value: "Bearer token" }],
			},
		];

		expect(toMcpServerRegistrations(servers)).toEqual([
			{
				name: "pandacode",
				transport: {
					type: "streamableHttp",
					url: "http://127.0.0.1:50843/mcp",
					headers: { Authorization: "Bearer token" },
				},
			},
		]);
	});

	it("maps sse servers and keeps an empty header list undefined", () => {
		const servers: McpServer[] = [
			{
				type: "sse",
				name: "legacy",
				url: "http://127.0.0.1:9000/sse",
				headers: [],
			},
		];

		const [registration] = toMcpServerRegistrations(servers);

		expect(registration?.transport).toEqual({
			type: "sse",
			url: "http://127.0.0.1:9000/sse",
			headers: undefined,
		});
	});

	it("maps stdio servers with args and env", () => {
		const servers: McpServer[] = [
			{
				name: "filesystem",
				command: "npx",
				args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
				env: [{ name: "DEBUG", value: "1" }],
			},
		];

		expect(toMcpServerRegistrations(servers)).toEqual([
			{
				name: "filesystem",
				transport: {
					type: "stdio",
					command: "npx",
					args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
					env: { DEBUG: "1" },
				},
			},
		]);
	});

	it("keeps the first definition when a name repeats", () => {
		const servers: McpServer[] = [
			{
				type: "http",
				name: "dup",
				url: "http://127.0.0.1:1/mcp",
				headers: [],
			},
			{
				type: "http",
				name: "dup",
				url: "http://127.0.0.1:2/mcp",
				headers: [],
			},
		];

		const registrations = toMcpServerRegistrations(servers);

		expect(registrations).toHaveLength(1);
		expect(registrations[0]?.transport).toMatchObject({
			url: "http://127.0.0.1:1/mcp",
		});
	});
});
