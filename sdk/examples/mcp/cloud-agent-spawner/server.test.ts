import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CloudAgentSpawner } from "./cloud-agent.js";
import { createCloudAgentMcpServer } from "./server.js";

describe("Cline Cloud Agent MCP server", () => {
	it("completes the MCP handshake and advertises its tools", async () => {
		const server = createCloudAgentMcpServer(new CloudAgentSpawner());
		const client = new Client({ name: "test-client", version: "1.0.0" });
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();

		try {
			await Promise.all([
				server.connect(serverTransport),
				client.connect(clientTransport),
			]);
			const result = await client.listTools();
			expect(result.tools.map(({ name }) => name)).toEqual([
				"start_cline_oauth",
				"get_cline_oauth_status",
				"spawn_cloud_agent",
				"get_cloud_agent_spawn_status",
			]);
			expect(
				result.tools.find(({ name }) => name === "spawn_cloud_agent")
					?.description,
			).toContain("Never retry");
		} finally {
			await Promise.all([client.close(), server.close()]);
		}
	});
});
