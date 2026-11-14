import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	HubEventEnvelope,
	PluginStatusRecord,
	SessionPluginIssue,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	PluginRegistry,
	resetProcessPluginRegistryForTests,
} from "../../extensions/plugin/plugin-registry";
import type {
	StartSessionInput,
	StartSessionResult,
} from "../../runtime/host/runtime-host";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { HubServerTransport } from "../server";

describe("Hub plugin status", () => {
	let root: string;
	let registry: PluginRegistry;

	function createTransport(startSession = vi.fn()) {
		return new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
			sessionHost: {
				subscribe: vi.fn(),
				startSession,
				stopSession: vi.fn(),
				runTurn: vi.fn(),
				abort: vi.fn(),
				dispose: vi.fn(),
				getSession: vi.fn().mockImplementation(async (sessionId: string) => ({
					sessionId,
					source: "core",
					status: "running",
					startedAt: new Date(0).toISOString(),
					updatedAt: new Date(0).toISOString(),
					interactive: true,
					provider: "cline",
					model: "test-model",
					cwd: root,
					workspaceRoot: root,
					enableTools: true,
					enableSpawn: true,
					enableTeams: false,
					isSubagent: false,
				})),
				getAccumulatedUsage: vi.fn().mockResolvedValue(undefined),
				listSessions: vi.fn(),
				deleteSession: vi.fn(),
				updateSession: vi.fn(),
				dispatchHookEvent: vi.fn(),
				readSessionMessages: vi.fn(),
			} as never,
		});
	}

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "cline-hub-plugins-"));
		registry = new PluginRegistry();
		resetProcessPluginRegistryForTests(registry);
	});

	afterEach(async () => {
		resetProcessPluginRegistryForTests(undefined);
		await rm(root, { recursive: true, force: true });
	});

	it("reports plugin status, broadcasts changes, and reloads a fixed plugin", async () => {
		const transport = createTransport();
		const events: HubEventEnvelope[] = [];
		transport.subscribe("ui", (event) => {
			if (event.event === "plugin.status_changed") events.push(event);
		});
		const pluginPath = join(root, "broken.js");
		await writeFile(
			pluginPath,
			`throw new Error("cannot import");\nexport default {};\n`,
		);
		try {
			await registry.loadForSession({
				sessionId: "s1",
				pluginPaths: [pluginPath],
			});

			const status = await transport.handleCommand({
				version: "v1",
				command: "plugins.status",
				clientId: "client-1",
			});
			expect(status.ok).toBe(true);
			const [plugin] = status.payload?.plugins as PluginStatusRecord[];
			expect(plugin).toMatchObject({
				name: "broken",
				pluginPath,
				state: "failed",
				lastError: { phase: "import", message: "cannot import" },
			});
			expect(
				events.map(
					(event) => (event.payload?.plugin as PluginStatusRecord).state,
				),
			).toEqual(["loading", "failed"]);

			const missing = await transport.handleCommand({
				version: "v1",
				command: "plugins.reload",
				payload: { plugin: "nope" },
			});
			expect(missing.error?.code).toBe("plugin_not_found");

			await writeFile(
				pluginPath,
				`export default { name: "broken", manifest: { capabilities: ["tools"] } };\n`,
			);
			const reloaded = await transport.handleCommand({
				version: "v1",
				command: "plugins.reload",
				payload: { plugin: "broken" },
			});
			expect(reloaded.ok).toBe(true);
			expect(
				(reloaded.payload?.plugins as PluginStatusRecord[])[0]?.state,
			).toBe("ready");
			expect(events.at(-1)?.payload?.plugin).toMatchObject({ state: "ready" });
		} finally {
			await transport.stop();
		}
	});

	it("passes the session plugin policy through and returns plugin issues", async () => {
		let captured: StartSessionInput | undefined;
		const issue: SessionPluginIssue = {
			name: "broken",
			pluginPath: join(root, "broken.js"),
			state: "failed",
			reason: "error",
			lastError: {
				phase: "setup",
				message: "setup exploded",
				pluginPath: join(root, "broken.js"),
				timestamp: 1,
			},
		};
		const startSession = vi.fn(
			async (input: StartSessionInput): Promise<StartSessionResult> => {
				captured = input;
				return {
					sessionId: input.config.sessionId ?? "session-1",
					manifest: {} as never,
					manifestPath: "",
					messagesPath: "",
					pluginIssues: [issue],
				};
			},
		);
		const transport = createTransport(startSession);
		const created: HubEventEnvelope[] = [];
		transport.subscribe("ui", (event) => {
			if (event.event === "session.created") created.push(event);
		});
		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "session.create",
				clientId: "client-1",
				payload: {
					workspaceRoot: root,
					cwd: root,
					sessionConfig: {
						sessionId: "session-plugins",
						providerId: "cline",
						modelId: "test-model",
						systemPrompt: "system",
					},
					plugins: {
						"*": { enabled: false },
						alpha: { enabled: true },
						ignored: "not a policy",
					},
				},
			});

			expect(reply.ok).toBe(true);
			expect(captured?.plugins).toEqual({
				"*": { enabled: false },
				alpha: { enabled: true },
				ignored: {},
			});
			expect(reply.payload?.pluginIssues).toEqual([issue]);
			expect(created[0]?.payload?.pluginIssues).toEqual([issue]);
		} finally {
			await transport.stop();
		}
	});
});
