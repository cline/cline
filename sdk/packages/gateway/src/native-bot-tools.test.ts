import { createRunId, createSessionId } from "@cline/shared/gateway";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayServer } from "./server";
import { ScriptedEnginePort, tempDataRoot } from "./test-support";
import { resolveToolSnapshot } from "./tools/resolver";

const servers: GatewayServer[] = [];

afterEach(async () => {
	for (const server of servers.splice(0)) {
		await server.stop("graceful").catch(() => {});
	}
});

describe("native lead bot tools", () => {
	it("binds list_bots and propose_new_bot from the execution snapshot", async () => {
		const server = await GatewayServer.start({
			dataRoot: tempDataRoot(),
			namespace: "native-bot-tools",
			engine: new ScriptedEnginePort(),
		});
		servers.push(server);
		const botId = server.runtime.defaultBotId;
		if (!botId) throw new Error("missing default bot");
		const executionSnapshot = resolveToolSnapshot(
			server.tools.catalog.current,
			{
				providerId: "anthropic",
				modelId: "claude",
				role: "lead",
				defaultProfiles: ["cline-dad"],
			},
		);

		const tools = server.agentTools({
			runId: createRunId(),
			sessionId: createSessionId(),
			botId,
			input: "list my bots",
			workspaceRoot: "/workspace",
			effectiveConfig: {},
			executionSnapshot,
		});

		expect(tools.map((tool) => tool.name)).toEqual(
			expect.arrayContaining(["list_bots", "propose_new_bot"]),
		);
		const listBots = tools.find((tool) => tool.name === "list_bots");
		await expect(
			listBots?.execute({}, { agentId: botId, iteration: 1 }),
		).resolves.toEqual(
			expect.objectContaining({
				count: 1,
				bots: [expect.objectContaining({ id: botId, role: "lead" })],
			}),
		);
	});
});
