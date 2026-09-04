import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
	} as unknown as SidecarContext;
	return { ctx, events };
}

let dataDir: string;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "cline-commands-settings-"));
	process.env.CLINE_DATA_DIR = dataDir;
});

afterEach(() => {
	delete process.env.CLINE_CODE_CLOUD_AGENTS;
	delete process.env.CLINE_CODE_CLOUD_HANDOFF;
	delete process.env.CLINE_DATA_DIR;
	rmSync(dataDir, { recursive: true, force: true });
});

describe("desktop settings commands", () => {
	it("reads default desktop settings with beta cloud availability", async () => {
		const { ctx } = createContext();

		await expect(
			handleCommand(ctx, "get_desktop_settings", {}),
		).resolves.toEqual({ cloudSessionsEnabled: false });
		await expect(
			handleCommand(ctx, "get_feature_flags", {}),
		).resolves.toMatchObject({
			cloudAgents: false,
			cloudAgentsAvailable: true,
			cloudHandoff: true,
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
		// change. Beta makes cloud capabilities available without PostHog; the
		// existing desktop opt-in remains the effective user-facing gate.
		expect(events).toEqual([
			{
				name: "feature_flags_changed",
				payload: {
					cloudAgents: true,
					cloudAgentsAvailable: true,
					cloudHandoff: true,
				},
			},
		]);
		await expect(
			handleCommand(ctx, "get_feature_flags", {}),
		).resolves.toMatchObject({ cloudAgents: true });
		await expect(
			handleCommand(ctx, "get_desktop_settings", {}),
		).resolves.toEqual({ cloudSessionsEnabled: true });

		await handleCommand(ctx, "set_cloud_sessions_enabled", {
			cloud_sessions_enabled: false,
		});
		expect(events.at(-1)).toEqual({
			name: "feature_flags_changed",
			payload: {
				cloudAgents: false,
				cloudAgentsAvailable: true,
				cloudHandoff: true,
			},
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
