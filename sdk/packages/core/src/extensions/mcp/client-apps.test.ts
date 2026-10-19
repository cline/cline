import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDefaultMcpServerClientFactory } from "./client";
import type { McpServerRegistration } from "./types";

const APPS_SERVER_SCRIPT = `
let buffer = "";
let initializeCapabilities;
process.stdin.on("data", (chunk) => {
	buffer += chunk.toString("utf8");
	let idx;
	while ((idx = buffer.indexOf("\\n")) >= 0) {
		const line = buffer.slice(0, idx).trim();
		buffer = buffer.slice(idx + 1);
		if (!line) continue;
		const msg = JSON.parse(line);
		if (msg.id === undefined) continue;
		let result;
		if (msg.method === "initialize") {
			initializeCapabilities = msg.params.capabilities;
			result = {
				protocolVersion: "2024-11-05",
				capabilities: { tools: {}, resources: {} },
				serverInfo: { name: "apps", version: "0.0.0" },
			};
		} else if (msg.method === "tools/list") {
			result = {
				tools: [
					{
						name: "show_weather",
						inputSchema: { type: "object" },
						_meta: { ui: { resourceUri: "ui://weather/view.html" } },
					},
					{ name: "plain", inputSchema: { type: "object" } },
				],
			};
		} else if (msg.method === "tools/call") {
			result = {
				content: [{ type: "text", text: JSON.stringify(initializeCapabilities) }],
			};
		} else if (msg.params?.uri === "ui://broken/missing-contents") {
			result = {};
		} else if (msg.params?.uri === "ui://broken/object-contents") {
			result = { contents: {} };
		} else if (msg.method === "resources/read") {
			result = {
				contents: [
					{
						uri: msg.params.uri,
						mimeType: "text/html;profile=mcp-app",
						text: "<html></html>",
						_meta: { ui: { prefersBorder: true } },
					},
				],
			};
		} else {
			result = {};
		}
		process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\\n");
	}
});
process.stdin.on("end", () => process.exit(0));
`;

let tempRoot = "";

beforeAll(() => {
	tempRoot = mkdtempSync(join(tmpdir(), "cline-mcp-apps-"));
	writeFileSync(join(tempRoot, "apps-server.js"), APPS_SERVER_SCRIPT);
});

afterAll(() => {
	rmSync(tempRoot, { recursive: true, force: true });
});

function appsServerRegistration(): McpServerRegistration {
	return {
		name: "apps-server",
		transport: {
			type: "stdio",
			command:
				process.platform === "win32"
					? `"${process.execPath}"`
					: process.execPath,
			args: [join(tempRoot, "apps-server.js")],
		},
	};
}

async function readInitializeCapabilities(
	mcpApps: boolean | undefined,
): Promise<unknown> {
	const client = await createDefaultMcpServerClientFactory({ mcpApps })(
		appsServerRegistration(),
	);
	try {
		await client.connect();
		const result = (await client.callTool({ name: "capabilities" })) as {
			content: Array<{ text: string }>;
		};
		return JSON.parse(result.content[0].text);
	} finally {
		await client.disconnect();
	}
}

describe("stdio MCP client app support", () => {
	it("advertises the MCP Apps extension only when enabled", async () => {
		expect(await readInitializeCapabilities(undefined)).toEqual({});
		expect(await readInitializeCapabilities(true)).toEqual({
			extensions: {
				"io.modelcontextprotocol/ui": {
					mimeTypes: ["text/html;profile=mcp-app"],
				},
			},
		});
	});

	it("keeps tool _meta and reads ui:// resources", async () => {
		const client = await createDefaultMcpServerClientFactory()(
			appsServerRegistration(),
		);
		try {
			await client.connect();
			expect(await client.listTools()).toEqual([
				{
					name: "show_weather",
					inputSchema: { type: "object" },
					_meta: { ui: { resourceUri: "ui://weather/view.html" } },
				},
				{ name: "plain", inputSchema: { type: "object" } },
			]);
			expect(
				await client.readResource?.({ uri: "ui://weather/view.html" }),
			).toEqual({
				contents: [
					{
						uri: "ui://weather/view.html",
						mimeType: "text/html;profile=mcp-app",
						text: "<html></html>",
						_meta: { ui: { prefersBorder: true } },
					},
				],
			});
		} finally {
			await client.disconnect();
		}
	});

	it("rejects malformed resources/read results", async () => {
		const client = await createDefaultMcpServerClientFactory()(
			appsServerRegistration(),
		);
		try {
			await client.connect();
			for (const uri of [
				"ui://broken/missing-contents",
				"ui://broken/object-contents",
			]) {
				await expect(client.readResource?.({ uri })).rejects.toThrow(
					'MCP server "apps-server" returned an invalid resources/read result',
				);
			}
		} finally {
			await client.disconnect();
		}
	});
});
