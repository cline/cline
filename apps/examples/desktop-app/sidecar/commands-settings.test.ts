import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	clearLiveModelsCatalogCache,
	resetClineRecommendedModelsCacheForTests,
} from "@cline/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import type { SidecarContext } from "./types";

function createContext(): {
	ctx: SidecarContext;
	events: Array<{ name: string; payload: Record<string, unknown> }>;
} {
	const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
	const ctx = {
		liveSessions: new Map(),
		restoringWorkspacePaths: new Set(),
		streamIndices: new Map(),
		wsClients: new Set([
			{
				send(message: string) {
					const parsed = JSON.parse(message) as {
						event: { name: string; payload: Record<string, unknown> };
					};
					events.push(parsed.event);
				},
			},
		]),
		pendingApprovals: new Map(),
		pendingQuestions: new Map(),
		sessionManager: null,
		hubClient: null,
		workspaceRoot: "/local/workspace",
		unsubscribeSessionEvents: null,
		cloudSessionManager: null,
	} as SidecarContext;
	return { ctx, events };
}

let dataDir: string;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "cline-commands-settings-"));
	process.env.CLINE_DATA_DIR = dataDir;
});

afterEach(() => {
	clearLiveModelsCatalogCache();
	resetClineRecommendedModelsCacheForTests();
	vi.unstubAllGlobals();
	delete process.env.CLINE_CODE_CLOUD_AGENTS;
	delete process.env.CLINE_DATA_DIR;
	rmSync(dataDir, { recursive: true, force: true });
});

describe("desktop settings commands", () => {
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

	it("reads default desktop settings and an off feature gate", async () => {
		const { ctx } = createContext();

		await expect(
			handleCommand(ctx, "get_desktop_settings", {}),
		).resolves.toEqual({ cloudSessionsEnabled: false });
		await expect(
			handleCommand(ctx, "get_feature_flags", {}),
		).resolves.toMatchObject({
			cloudAgents: false,
			cloudAgentsAvailable: false,
		});
	});

	it("rejects a non-boolean cloud sessions toggle value", async () => {
		const { ctx, events } = createContext();

		await expect(
			handleCommand(ctx, "set_cloud_sessions_enabled", {
				cloud_sessions_enabled: "yes",
			}),
		).rejects.toThrow("cloud_sessions_enabled must be a boolean");
		expect(events).toEqual([]);
	});

	it("persists the toggle and broadcasts the new gate immediately", async () => {
		const { ctx, events } = createContext();

		await expect(
			handleCommand(ctx, "set_cloud_sessions_enabled", {
				cloud_sessions_enabled: true,
			}),
		).resolves.toEqual({ cloudSessionsEnabled: true });
		// Open webviews re-evaluate without waiting for a restart or account
		// change. With the rollout flag off (NoOp provider in tests) the
		// opt-in alone keeps the effective gate closed.
		expect(events).toEqual([
			{
				name: "feature_flags_changed",
				payload: { cloudAgents: false, cloudAgentsAvailable: false },
			},
		]);
		await expect(
			handleCommand(ctx, "get_feature_flags", {}),
		).resolves.toMatchObject({ cloudAgents: false });
		await expect(
			handleCommand(ctx, "get_desktop_settings", {}),
		).resolves.toEqual({ cloudSessionsEnabled: true });

		await handleCommand(ctx, "set_cloud_sessions_enabled", {
			cloud_sessions_enabled: false,
		});
		expect(events.at(-1)).toEqual({
			name: "feature_flags_changed",
			payload: { cloudAgents: false, cloudAgentsAvailable: false },
		});
	});

	it("reports the env override through the feature gate", async () => {
		const { ctx } = createContext();
		process.env.CLINE_CODE_CLOUD_AGENTS = "1";

		await expect(
			handleCommand(ctx, "get_feature_flags", {}),
		).resolves.toMatchObject({
			cloudAgents: true,
			cloudAgentsAvailable: true,
		});
		// The toggle's stored value is reported as-is; the override only
		// affects the effective gate.
		await expect(
			handleCommand(ctx, "get_desktop_settings", {}),
		).resolves.toEqual({ cloudSessionsEnabled: false });
	});
});
