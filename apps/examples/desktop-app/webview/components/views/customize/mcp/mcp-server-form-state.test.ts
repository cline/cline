import { describe, expect, it } from "vitest";
import type { McpServer } from "@/lib/extension-inventory";
import {
	buildServerInput,
	createServerFormState,
} from "./mcp-server-form-state";

describe("MCP server form state", () => {
	it("round-trips local settings while retaining the identity used for renames", () => {
		const server: McpServer = {
			name: "local-tools",
			transportType: "stdio",
			command: "bun",
			args: ["run", "server.ts"],
			cwd: "/workspace",
			env: { TOKEN: "  keep whitespace = intact  " },
			disabled: true,
			metadata: { custom: ["value"] },
		};
		const form = createServerFormState(server);
		form.name = "renamed-tools";
		expect(buildServerInput(form)).toEqual({
			...server,
			name: "renamed-tools",
			previousName: "local-tools",
		});
	});

	it.each([
		" foo ",
		"",
	])("sends the stored name %j unchanged as the rename source", (storedName) => {
		const form = createServerFormState({
			name: storedName,
			transportType: "stdio",
			command: "node",
			disabled: true,
		});
		form.name = "renamed";
		expect(buildServerInput(form)).toMatchObject({
			name: "renamed",
			previousName: storedName,
		});
	});

	it.each([
		"sse",
		"streamableHttp",
	] as const)("round-trips %s without accidentally including stale local fields", (transportType) => {
		const server: McpServer = {
			name: "remote-tools",
			transportType,
			url: "https://example.com/mcp",
			headers: { Authorization: "Bearer token=with=equals" },
			disabled: false,
		};
		const form = createServerFormState(server);
		form.command = "bun";
		form.argsText = "server.ts";
		form.cwd = "/workspace";
		form.envEntries[0] = { id: "env", key: "TOKEN", value: "secret" };
		expect(buildServerInput(form)).toEqual({
			...server,
			previousName: "remote-tools",
			metadata: undefined,
		});
	});

	it("starts new local servers enabled and rejects incomplete or invalid input", () => {
		const form = createServerFormState();
		expect(form.disabled).toBe(false);
		expect(form.transportType).toBe("stdio");
		expect(form.envEntries).toEqual([
			{ id: expect.any(String), key: "", value: "" },
		]);
		expect(() => buildServerInput(form)).toThrow("Server name is required.");
		form.name = "tools";
		expect(() => buildServerInput(form)).toThrow(
			"Command is required for local servers.",
		);
		form.transportType = "streamableHttp";
		expect(() => buildServerInput(form)).toThrow(
			"Server URL is required for remote servers.",
		);
		form.url = "https://example.com/mcp";
		form.metadataText = "{";
		expect(() => buildServerInput(form)).toThrow();
	});

	it("preserves comma-separated parsing and omits empty optional values", () => {
		const form = createServerFormState();
		form.name = " tools ";
		form.command = " bun ";
		form.argsText = " run, , server.ts, ";
		form.envEntries.push({ id: "blank", key: "  ", value: "ignored" });
		expect(buildServerInput(form)).toEqual({
			name: "tools",
			transportType: "stdio",
			command: "bun",
			args: ["run", "server.ts"],
			previousName: undefined,
			cwd: undefined,
			env: undefined,
			disabled: false,
			metadata: undefined,
		});
		form.transportType = "sse";
		form.url = " https://example.com/mcp ";
		form.headersText = " Invalid, =skip, X-Token = one=two, X-Empty= ";
		expect(buildServerInput(form)).toMatchObject({
			url: "https://example.com/mcp",
			headers: { "X-Token": "one=two", "X-Empty": "" },
		});
	});
});
