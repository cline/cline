import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	clearLiveModelsCatalogCache,
	resetClineRecommendedModelsCacheForTests,
} from "@cline/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCloudSessionManager } from "./cloud-sessions";
import { handleCommand } from "./commands";
import { createSidecarContext } from "./context";
import {
	getDesktopFeatureFlagsService,
	resetDesktopFeatureFlagsForTesting,
} from "./feature-flags";
import { recordHubActivity } from "./hub-admin";
import {
	LOCAL_ENVIRONMENT_ID,
	type SessionRuntimeBinding,
	type SidecarContext,
} from "./types";

function createContext(): {
	ctx: SidecarContext;
	events: Array<{ name: string; payload: Record<string, unknown> }>;
} {
	const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
	const ctx = createSidecarContext("/local/workspace");
	ctx.wsClients.add({
		send: (message) => events.push(JSON.parse(message).event),
	});
	return { ctx, events };
}

let dataDir: string;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "cline-commands-settings-"));
	process.env.CLINE_DATA_DIR = dataDir;
	resetDesktopFeatureFlagsForTesting();
});

afterEach(() => {
	clearLiveModelsCatalogCache();
	resetClineRecommendedModelsCacheForTests();
	vi.unstubAllGlobals();
	delete process.env.CLINE_CODE_CLOUD_AGENTS;
	delete process.env.CLINE_DATA_DIR;
	resetDesktopFeatureFlagsForTesting();
	rmSync(dataDir, { recursive: true, force: true });
});

describe("desktop settings commands", () => {
	it("only returns hub notification content to trusted desktop connections", async () => {
		const { ctx } = createContext();
		const command = vi
			.fn()
			.mockResolvedValue({ ok: true, payload: { clients: [] } });
		ctx.runtimeBindings.set(LOCAL_ENVIRONMENT_ID, {
			hubClient: { command, getUrl: () => "ws://127.0.0.1:1234/hub" },
		} as unknown as SessionRuntimeBinding);
		recordHubActivity(ctx, {
			event: "ui.notify",
			payload: { title: "Task completed", body: "Private task reply" },
		});
		await expect(handleCommand(ctx, "get_hub_status")).rejects.toThrow(
			"hub status requires a trusted desktop connection",
		);
		await expect(
			handleCommand(ctx, "get_hub_status", undefined, {
				connection: { send: vi.fn(), data: { canApproveTools: false } },
			}),
		).rejects.toThrow("hub status requires a trusted desktop connection");
		expect(command).not.toHaveBeenCalled();
		const result = await handleCommand(ctx, "get_hub_status", undefined, {
			connection: { send: vi.fn(), data: { canApproveTools: true } },
		});
		expect(command).toHaveBeenCalledWith("client.list");
		expect(result).toMatchObject({
			events: [{ title: "Task completed", detail: "Private task reply" }],
		});
	});

	it("rejects hub restarts from untrusted connections", async () => {
		const { ctx } = createContext();
		await expect(handleCommand(ctx, "restart_hub")).rejects.toThrow(
			"trusted desktop connection",
		);
	});
	it("lists only current gateway transcription models for voice input", async () => {
		const { ctx } = createContext();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					data: [
						{
							id: "stt",
							modalities: { input: ["audio"], output: ["text"] },
							supported_specifications: ["v4"],
						},
						{
							id: "transcribe-chat",
							type: "language",
							modalities: { input: ["text", "audio"], output: ["text"] },
							supported_specifications: ["v4"],
						},
					],
				}),
			),
		);
		const result = (await handleCommand(ctx, "list_transcription_models", {
			provider: "vercel-ai-gateway",
		})) as { models: Array<{ id: string }> };
		expect(result.models.map((model) => model.id)).toEqual(["stt"]);
	});

	it.each([
		"list_chat_sessions",
		"list_discovered_sessions",
		"search_sessions",
	])("hides cloud rows from %s unless the rollout flag is enabled", async (command) => {
		const { ctx } = createContext();
		for (const target of ["local", "cloud"] as const) {
			ctx.liveSessions.set(target, {
				config: { executionTarget: target, provider: "cline", model: "test" },
				prompt: "match",
				messages: [],
				promptsInQueue: [],
				busy: false,
				status: "completed",
				startedAt: Date.now(),
			});
		}
		const cloudRows = [
			{ sessionId: "cloud", origin: "cloud", prompt: "match" },
		];
		const discovery = vi
			.spyOn(getCloudSessionManager(ctx), "listForDiscovery")
			.mockResolvedValue(cloudRows);
		const flags = getDesktopFeatureFlagsService();
		flags.hydrateCache({
			userId: null,
			updateTime: Date.now(),
			flagsPayload: { featureFlags: { "code-cloud-agents": true } },
		});
		const rows = async () =>
			(
				(await handleCommand(ctx, command, { query: "match" })) as Array<{
					sessionId: string;
				}>
			)
				.map((row) => row.sessionId)
				.sort();

		expect(await rows()).toEqual(["cloud", "local"]);
		discovery.mockImplementationOnce(async () => {
			process.env.CLINE_CODE_CLOUD_AGENTS = "0";
			return cloudRows;
		});
		expect(await rows()).toEqual(["local"]);
		delete process.env.CLINE_CODE_CLOUD_AGENTS;
		discovery.mockClear();
		flags.hydrateCache({
			userId: null,
			updateTime: Date.now(),
			flagsPayload: { featureFlags: { "code-cloud-agents": false } },
		});
		expect(await rows()).toEqual(["local"]);
		expect(discovery).not.toHaveBeenCalled();
		expect(ctx.liveSessions.has("cloud")).toBe(true);
	});

	it("loads cloud-only models only for an enabled cloud picker", async () => {
		const { ctx } = createContext();
		const fetchMock = vi.fn(async (input: string | URL | Request) => {
			if (String(input) === "https://models.dev/api.json") {
				return new Response(JSON.stringify({}), { status: 200 });
			}
			return new Response(
				JSON.stringify({
					clineCloud: [
						{
							id: "cline-cloud/cloud-only",
							name: "Cloud Only",
						},
					],
				}),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		process.env.CLINE_CODE_CLOUD_AGENTS = "0";
		const local = (await handleCommand(ctx, "list_provider_models", {
			provider: "cline",
			includeCloudModels: true,
		})) as { models: Array<{ id: string }> };
		expect(
			local.models.some((model) => model.id.startsWith("cline-cloud/")),
		).toBe(false);

		process.env.CLINE_CODE_CLOUD_AGENTS = "1";
		const cloud = (await handleCommand(ctx, "list_provider_models", {
			provider: "cline",
			includeCloudModels: true,
		})) as { models: Array<{ id: string }> };
		expect(cloud.models).toContainEqual(
			expect.objectContaining({ id: "cline-cloud/cloud-only" }),
		);
	});
});
