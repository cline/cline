import { createBotId, createSessionId } from "@cline/shared/gateway";
import { describe, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import type { SidecarContext } from "./types";

function context(client: Record<string, unknown>): SidecarContext {
	return {
		client: client as unknown as SidecarContext["client"],
		gatewayUpdateRequired: false,
		updateGateway: vi.fn(async () => {}),
		workspaceRoot: "/workspace/project",
		sockets: new Set(),
		activeRuns: new Map(),
		pendingApprovals: new Map(),
	};
}

describe("Gateway desktop commands", () => {
	it("blocks normal commands until the user updates an incompatible Gateway", async () => {
		const ctx = context({});
		ctx.gatewayUpdateRequired = true;
		await expect(handleCommand(ctx, "list_bots")).rejects.toThrow(
			"Gateway must be updated",
		);
	});

	it("updates an incompatible Gateway only after an explicit command", async () => {
		const ctx = context({});
		ctx.gatewayUpdateRequired = true;
		const updateGateway = vi.fn(async () => {
			ctx.gatewayUpdateRequired = false;
		});
		ctx.updateGateway = updateGateway;
		expect(await handleCommand(ctx, "get_gateway_update_status")).toMatchObject({
			updateRequired: true,
		});
		await handleCommand(ctx, "update_gateway_server");
		expect(updateGateway).toHaveBeenCalledOnce();
	});

	it("creates a session without requiring a prompt", async () => {
		const botId = createBotId();
		const sessionId = createSessionId();
		const createSession = vi.fn(async () => ({
			sessionId,
			botId,
			workspace: { rootPath: "/workspace/project" },
			state: "active",
			kind: "canonical",
			createdAt: 1,
			revision: 0,
		}));
		const result = await handleCommand(
			context({
				listBots: async () => ({
					bots: [{ identity: { botId } }],
				}),
				createSession,
			}),
			"chat_session_command",
			{ request: { action: "start", config: {} } },
		);
		expect(createSession).toHaveBeenCalledWith({
			botId,
			workspaceRoot: "/workspace/project",
		});
		expect(result).toMatchObject({ sessionId });
	});

	it("returns the SDK provider catalog through the UI command name", async () => {
		const result = await handleCommand(
			context({}),
			"list_provider_catalog",
		);
		expect(result).toMatchObject({ providers: expect.any(Array) });
		expect((result as { providers: unknown[] }).providers.length).toBeGreaterThan(0);
	});
});
