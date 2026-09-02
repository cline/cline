import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	type CorePluginSettingsSnapshot,
	type CorePluginSettingsSource,
	CoreSettingsService,
} from "../settings";
import { createLocalHubScheduleRuntimeHandlers } from "./daemon/runtime-handlers";
import { HubServerTransport } from "./server";

function createHostPluginSettingsSnapshot(
	enabled: boolean,
): CorePluginSettingsSnapshot {
	return {
		plugins: [
			{
				id: "host:memory-plugin",
				name: "memory-plugin",
				path: "host:memory-plugin",
				kind: "plugin",
				source: "workspace-plugin",
				enabled,
				toggleable: true,
				contributions: {
					inspectionStatus: "available",
					capabilities: ["tools"],
					tools: ["memory_tool"],
					skills: [],
					rules: [],
					hooks: [],
					commands: [],
					mcpServers: [],
					providers: [],
				},
			},
		],
		tools: [
			{
				id: "memory-plugin:memory_tool",
				name: "memory_tool",
				path: "host:memory-plugin",
				kind: "tool",
				source: "workspace-plugin",
				enabled,
				pluginName: "memory-plugin",
				pluginPath: "host:memory-plugin",
			},
		],
	};
}

describe("hub settings commands", () => {
	it("persists generate_media opt-in state through settings.toggle", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "hub-tool-settings-"));
		const settingsPath = join(tempRoot, "global-settings.json");
		const previousSettingsPath = process.env.CLINE_GLOBAL_SETTINGS_PATH;
		process.env.CLINE_GLOBAL_SETTINGS_PATH = settingsPath;
		let transport: HubServerTransport | undefined;

		try {
			await writeFile(
				settingsPath,
				`${JSON.stringify({ disabledTools: ["generate_media", "read_file"] })}\n`,
				"utf8",
			);
			transport = new HubServerTransport({
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				settingsService: new CoreSettingsService(),
			});
			const enabled = await transport.handleCommand({
				version: "v1",
				command: "settings.toggle",
				requestId: "enable-generate-media",
				clientId: "desktop-sidecar",
				payload: {
					type: "tools",
					name: "generate_media",
					enabled: true,
					workspaceRoot: tempRoot,
					cwd: tempRoot,
				},
			});

			expect(enabled).toMatchObject({
				ok: true,
				payload: { changedTypes: ["tools"] },
			});
			expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
				autoUpdateEnabled: true,
				telemetryOptOut: false,
				disabledTools: ["read_file"],
				tools: { generate_media: { enabled: true } },
			});

			const disabled = await transport.handleCommand({
				version: "v1",
				command: "settings.toggle",
				requestId: "disable-generate-media",
				clientId: "desktop-sidecar",
				payload: {
					type: "tools",
					name: "generate_media",
					enabled: false,
					workspaceRoot: tempRoot,
					cwd: tempRoot,
				},
			});

			expect(disabled).toMatchObject({
				ok: true,
				payload: { changedTypes: ["tools"] },
			});
			expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
				autoUpdateEnabled: true,
				telemetryOptOut: false,
				disabledTools: ["read_file"],
				tools: { generate_media: { enabled: false } },
			});
		} finally {
			await transport?.stop();
			if (previousSettingsPath === undefined) {
				delete process.env.CLINE_GLOBAL_SETTINGS_PATH;
			} else {
				process.env.CLINE_GLOBAL_SETTINGS_PATH = previousSettingsPath;
			}
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	it("uses an injected host plugin source across list and toggle commands", async () => {
		let enabled = true;
		const pluginSource: CorePluginSettingsSource = {
			async list() {
				return createHostPluginSettingsSnapshot(enabled);
			},
			async setEnabled(input) {
				enabled = input.enabled;
				return createHostPluginSettingsSnapshot(enabled);
			},
		};
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
			settingsService: new CoreSettingsService({ pluginSource }),
		});

		try {
			const listed = await transport.handleCommand({
				version: "v1",
				command: "settings.list",
				requestId: "host-list",
				clientId: "host-client",
				payload: {},
			});
			expect(listed.payload?.snapshot).toMatchObject({
				plugins: expect.arrayContaining([
					expect.objectContaining({
						path: "host:memory-plugin",
						enabled: true,
					}),
				]),
			});

			const toggled = await transport.handleCommand({
				version: "v1",
				command: "settings.toggle",
				requestId: "host-toggle",
				clientId: "host-client",
				payload: {
					type: "plugins",
					path: "host:memory-plugin",
					enabled: false,
				},
			});
			expect(toggled.payload?.snapshot).toMatchObject({
				plugins: expect.arrayContaining([
					expect.objectContaining({
						path: "host:memory-plugin",
						enabled: false,
					}),
				]),
			});
		} finally {
			await transport.stop();
		}
	});

	it("publishes committed host plugin state without a post-mutation source read", async () => {
		let enabled = true;
		let mutationCommitted = false;
		let listCalls = 0;
		const pluginSource: CorePluginSettingsSource = {
			async list() {
				listCalls += 1;
				if (mutationCommitted) {
					throw new Error("source read attempted after mutation");
				}
				return createHostPluginSettingsSnapshot(enabled);
			},
			async setEnabled(input) {
				enabled = input.enabled;
				mutationCommitted = true;
				return createHostPluginSettingsSnapshot(enabled);
			},
		};
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
			settingsService: new CoreSettingsService({ pluginSource }),
		});
		const settingsEvents: unknown[] = [];
		const unsubscribe = transport.subscribe("host-client", (event) => {
			if (event.event === "settings.changed") {
				settingsEvents.push(event.payload);
			}
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "settings.toggle",
				requestId: "host-toggle",
				clientId: "host-client",
				payload: {
					type: "plugins",
					path: "host:memory-plugin",
				},
			});

			expect(reply).toMatchObject({
				ok: true,
				payload: {
					changedTypes: ["plugins"],
					snapshot: {
						plugins: expect.arrayContaining([
							expect.objectContaining({
								path: "host:memory-plugin",
								enabled: false,
							}),
						]),
					},
				},
			});
			expect(listCalls).toBe(1);
			expect(settingsEvents).toHaveLength(1);
			expect(settingsEvents[0]).toMatchObject({
				types: ["plugins"],
				snapshot: {
					plugins: expect.arrayContaining([
						expect.objectContaining({
							path: "host:memory-plugin",
							enabled: false,
						}),
					]),
				},
			});
		} finally {
			unsubscribe();
			await transport.stop();
		}
	});

	it("returns an updated snapshot and publishes settings.changed after toggle", async () => {
		const snapshot = {
			workflows: [],
			rules: [],
			skills: [
				{
					id: "skill-one",
					name: "skill-one",
					path: "/tmp/SKILL.md",
					kind: "skill" as const,
					source: "workspace" as const,
					enabled: false,
					toggleable: true,
				},
			],
			plugins: [],
			tools: [],
			mcp: [],
		};
		const settingsService = {
			toggle: vi.fn().mockResolvedValue({
				snapshot,
				changedTypes: ["skills"],
			}),
		} as unknown as CoreSettingsService;
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
			settingsService,
		});
		const events: string[] = [];
		const unsubscribe = transport.subscribe("client-one", (event) => {
			if (event.event === "settings.changed") {
				events.push(JSON.stringify(event.payload));
			}
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "settings.toggle",
				requestId: "req-1",
				clientId: "client-one",
				payload: {
					type: "skills",
					id: "skill-one",
					enabled: false,
				},
			});

			expect(reply).toMatchObject({
				ok: true,
				payload: {
					snapshot,
					changedTypes: ["skills"],
				},
			});
			expect(settingsService.toggle).toHaveBeenCalledWith({
				type: "skills",
				id: "skill-one",
				enabled: false,
			});
			expect(events).toHaveLength(1);
			expect(JSON.parse(events[0] ?? "{}")).toMatchObject({
				types: ["skills"],
				snapshot,
			});
		} finally {
			unsubscribe();
			await transport.stop();
		}
	});

	it("forwards explicit Agent Plugin paths to the hub settings service", async () => {
		const snapshot = {
			workflows: [],
			rules: [],
			skills: [],
			plugins: [],
			tools: [],
			mcp: [],
		};
		const settingsService = {
			list: vi.fn().mockResolvedValue(snapshot),
		} as unknown as CoreSettingsService;
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
			settingsService,
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "settings.list",
				requestId: "agent-plugins-list",
				clientId: "cli",
				payload: {
					cwd: "/workspace",
					workspaceRoot: "/workspace",
					agentPluginPaths: ["./portable"],
					includePluginTools: false,
				},
			});

			expect(reply).toMatchObject({ ok: true, payload: { snapshot } });
			expect(settingsService.list).toHaveBeenCalledWith({
				cwd: "/workspace",
				workspaceRoot: "/workspace",
				agentPluginPaths: ["./portable"],
				includePluginTools: false,
				availabilityContext: undefined,
			});
		} finally {
			await transport.stop();
		}
	});

	it("rejects malformed settings.toggle payloads before calling settings", async () => {
		const settingsService = {
			toggle: vi.fn(),
		} as unknown as CoreSettingsService;
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
			settingsService,
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "settings.toggle",
				requestId: "req-1",
				clientId: "client-one",
				payload: {
					type: "skillz",
				},
			});

			expect(reply).toMatchObject({
				ok: false,
				error: {
					code: "settings_toggle_failed",
				},
			});
			expect(reply.error?.message).toContain("settings.toggle payload 'type'");
			expect(settingsService.toggle).not.toHaveBeenCalled();
		} finally {
			await transport.stop();
		}
	});

	it("rejects malformed settings.list payloads before calling settings", async () => {
		const settingsService = {
			list: vi.fn(),
		} as unknown as CoreSettingsService;
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
			settingsService,
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "settings.list",
				requestId: "req-1",
				clientId: "client-one",
				payload: {
					workspaceRoot: false,
				},
			});

			expect(reply).toMatchObject({
				ok: false,
				error: {
					code: "settings_list_failed",
				},
			});
			expect(reply.error?.message).toContain("workspaceRoot");
			expect(settingsService.list).not.toHaveBeenCalled();
		} finally {
			await transport.stop();
		}
	});
});
