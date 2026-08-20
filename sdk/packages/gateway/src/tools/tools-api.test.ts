import { afterEach, describe, expect, it } from "vitest";
import { GatewayClient } from "../client";
import { GatewayServer } from "../server";
import { ScriptedEnginePort, tempDataRoot } from "../test-support";

const servers: GatewayServer[] = [];
const clients: GatewayClient[] = [];

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const server of servers.splice(0))
		await server.stop("graceful").catch(() => {});
});

describe("Gateway tool client surface", () => {
	it("lists, configures, previews, and durably snapshots built-in tools", async () => {
		const engine = new ScriptedEnginePort();
		const server = await GatewayServer.start({
			dataRoot: tempDataRoot(),
			namespace: "tools",
			engine,
		});
		servers.push(server);
		if (!server.discovery) throw new Error("missing discovery record");
		const client = await GatewayClient.connectToDiscovery(server.discovery, {
			clientName: "tools-test",
			clientVersion: "1",
		});
		clients.push(client);
		const botId = server.runtime.defaultBotId;
		if (!botId) throw new Error("missing default bot");

		const catalog = await client.listTools();
		expect(catalog.entries.map((entry) => entry.descriptor.id)).toContain(
			"builtin:read_files",
		);
		const saved = await client.putToolConfiguration({
			scope: { kind: "bot", botId },
			config: {
				assignments: [
					{
						when: { providers: ["ollama"] },
						deny: ["builtin:fetch_web_content"],
					},
				],
			},
			expectedRevision: 0,
		});
		expect(saved.revision).toBe(1);
		expect(await client.getToolConfiguration({ kind: "bot", botId })).toEqual(
			saved,
		);
		const preview = await client.previewEffectiveTools({
			botId,
			workspaceRoot: "/workspace",
			providerId: "ollama",
			modelId: "qwen",
		});
		expect(preview.resolutions).toContainEqual(
			expect.objectContaining({
				toolId: "builtin:fetch_web_content",
				status: "denied",
			}),
		);
	});
});
