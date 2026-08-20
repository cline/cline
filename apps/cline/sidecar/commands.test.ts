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
		expect(await handleCommand(ctx, "get_gateway_update_status")).toMatchObject(
			{
				updateRequired: true,
			},
		);
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

	it("uploads browser image and file attachments before starting the run", async () => {
		const botId = createBotId();
		const sessionId = createSessionId();
		const mutate = vi
			.fn()
			.mockResolvedValueOnce({ path: "/workspace/.cline/uploads/image.png" })
			.mockResolvedValueOnce({ path: "/workspace/.cline/uploads/notes.txt" });
		const startRun = vi.fn(async () => ({ runId: "run_test" }));
		await handleCommand(
			context({
				listBots: async () => ({ bots: [{ identity: { botId } }] }),
				mutate,
				startRun,
				listRuns: async () => ({ runs: [{ sessionId }] }),
			}),
			"chat_session_command",
			{
				request: {
					action: "send",
					sessionId,
					prompt: "inspect these",
					config: {},
					attachments: {
						userImages: ["data:image/png;base64,aW1hZ2U="],
						userFiles: [{ name: "notes.txt", content: "hello" }],
					},
				},
			},
		);
		expect(mutate).toHaveBeenNthCalledWith(1, "workspace.file.upload", {
			sessionId,
			name: "image-1.png",
			mediaType: "image/png",
			base64: "aW1hZ2U=",
		});
		expect(mutate).toHaveBeenNthCalledWith(2, "workspace.file.upload", {
			sessionId,
			name: "notes.txt",
			mediaType: "text/plain",
			base64: "aGVsbG8=",
		});
		expect(startRun).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId,
				prompt: expect.stringContaining(
					"[uploaded image: /workspace/.cline/uploads/image.png]",
				),
			}),
		);
	});

	it("returns Gateway sessions with the provider and model fields required by history", async () => {
		const botId = createBotId();
		const sessionId = createSessionId();
		const result = await handleCommand(
			context({
				listBots: async () => ({ bots: [] }),
				listSessions: async () => ({
					sessions: [
						{
							sessionId,
							botId,
							workspace: { rootPath: "/workspace/project" },
							state: "active",
							createdAt: 10,
						},
					],
				}),
				getSession: async () => ({
					runs: [{ state: "completed" }],
					messages: [
						{
							message: {
								role: "user",
								content: [{ type: "text", text: "hello" }],
								createdAt: 11,
							},
						},
						{
							message: {
								role: "assistant",
								content: [{ type: "text", text: "hi" }],
								createdAt: 12,
								modelInfo: { provider: "anthropic", id: "claude" },
							},
						},
					],
				}),
			}),
			"list_discovered_sessions",
			{ limit: 50 },
		);
		expect(result).toEqual([
			expect.objectContaining({
				sessionId,
				provider: "anthropic",
				model: "claude",
				prompt: "hello",
				status: "completed",
			}),
		]);
	});

	it("returns the native Gateway connector catalog and active records", async () => {
		const result = await handleCommand(
			context({
				listConnectors: async () => ({ connectors: [] }),
				getStatus: async () => ({
					instanceId: "gwi_test",
					pid: 42,
					namespace: "desktop",
				}),
			}),
			"list_connector_channels",
		);
		expect(
			(result as { available: Array<{ id: string }> }).available.map(
				(channel) => channel.id,
			),
		).toEqual(["telegram", "slack"]);
	});

	it("returns the SDK provider catalog through the UI command name", async () => {
		const result = await handleCommand(context({}), "list_provider_catalog");
		expect(result).toMatchObject({ providers: expect.any(Array) });
		expect(
			(result as { providers: unknown[] }).providers.length,
		).toBeGreaterThan(0);
	});
});
