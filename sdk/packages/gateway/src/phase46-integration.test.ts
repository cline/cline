/**
 * Phase 4-6 integration over the real server (real TCP, real SQLite):
 * catalog generation pinning by active runs, isolation visibility in
 * gateway.status, and the connector/schedule wire methods stacked on the
 * Phase 3 protocol (hello-first auth, idempotent mutations).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type BotId, createGatewayInstanceId } from "@cline/shared/gateway";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayClient } from "./client";
import { openGatewayDatabase } from "./db";
import { ensureGatewayDataDir, resolveGatewayPaths } from "./paths";
import { PluginCatalog } from "./plugins/catalog";
import { AGENT_PLUGIN_SCHEMA_1_0_0 } from "./plugins/manifest";
import { GatewayRuntime } from "./runtime";
import { GatewayServer, type GatewayServerOptions } from "./server";
import { createGatewayStores } from "./stores";
import { ScriptedEnginePort, tempDataRoot, waitFor } from "./test-support";

const servers: GatewayServer[] = [];
const clients: GatewayClient[] = [];

afterEach(async () => {
	for (const client of clients.splice(0)) {
		client.close();
	}
	for (const server of servers.splice(0)) {
		await server.stop("graceful").catch(() => {});
	}
});

async function startServer(overrides: Partial<GatewayServerOptions> = {}) {
	const engine =
		(overrides.engine as ScriptedEnginePort | undefined) ??
		new ScriptedEnginePort();
	engine.autoOutcome ??= () => ({ outputText: "ok" });
	const dataRoot = tempDataRoot();
	const server = await GatewayServer.start({
		dataRoot,
		namespace: "default",
		engine,
		schedulerTickMs: 25,
		...overrides,
	});
	servers.push(server);
	const discovery = server.discovery;
	if (!discovery) {
		throw new Error("no discovery record");
	}
	const client = await GatewayClient.connectToDiscovery(discovery, {
		clientName: "phase46-test",
		clientVersion: "0.0.1",
	});
	clients.push(client);
	const botId = server.runtime.defaultBotId as BotId;
	return { server, engine, client, botId, dataRoot };
}

describe("generation pinning by active runs", () => {
	it("active runs pin their catalog generation until terminal", async () => {
		const pluginsDir = tempDataRoot("cline-pin-plugins-");
		const pluginRoot = join(pluginsDir, "tool");
		mkdirSync(pluginRoot, { recursive: true });
		writeFileSync(
			join(pluginRoot, "plugin.json"),
			JSON.stringify({ $schema: AGENT_PLUGIN_SCHEMA_1_0_0, name: "tool" }),
		);

		const dataRoot = tempDataRoot();
		const paths = resolveGatewayPaths({ dataRoot, namespace: "default" });
		ensureGatewayDataDir(paths);
		const database = openGatewayDatabase(paths.databaseFile);
		const instanceId = createGatewayInstanceId();
		const stores = createGatewayStores(database, instanceId);
		const catalog = new PluginCatalog({
			sources: [{ scope: { kind: "global" }, dir: pluginsDir }],
		});
		catalog.reload();
		const engine = new ScriptedEnginePort();
		const runtime = new GatewayRuntime({
			database,
			stores,
			paths,
			instanceId,
			engine,
			plugins: catalog,
		});
		runtime.bootstrap();
		const botId = runtime.defaultBotId as BotId;

		const accepted = runtime.startRun("test", { botId, prompt: "work" });
		const pinnedGeneration = runtime.catalogGenerationForRun(accepted.runId);
		expect(pinnedGeneration).toBe(catalog.current.generation);

		// Two reloads publish newer generations while the run is active.
		catalog.reload();
		catalog.reload();
		expect(catalog.current.generation).not.toBe(pinnedGeneration);
		expect(runtime.pinnedCatalogGenerations()).toEqual([pinnedGeneration]);
		expect(catalog.heldGenerations()).toContain(pinnedGeneration);

		// Terminal run releases the pin; the old generation is collected.
		engine.handles[0].settle({ outputText: "done" });
		await waitFor(() => stores.runs.get(accepted.runId)?.state === "completed");
		expect(runtime.pinnedCatalogGenerations()).toEqual([]);
		expect(catalog.heldGenerations()).not.toContain(pinnedGeneration);
		database.close();
	});
});

describe("status visibility", () => {
	it("reports execution isolation, plugins, connectors, and schedules", async () => {
		const { client } = await startServer({
			executionHealth: () => ({
				isolation: "unsandboxed-development",
				development: true,
			}),
		});
		const status = (await client.request("gateway.status")) as Record<
			string,
			// biome-ignore lint/suspicious/noExplicitAny: test projection
			any
		>;
		expect(status.execution.isolation).toBe("unsandboxed-development");
		expect(status.execution.development).toBe(true);
		expect(status.plugins.generation).toBeGreaterThan(0);
		expect(status.counts.connectors).toBe(0);
		expect(status.counts.schedules).toBe(0);
	});

	it("defaults to reporting the direct in-process development mode", async () => {
		const { client } = await startServer();
		const status = (await client.request("gateway.status")) as Record<
			string,
			// biome-ignore lint/suspicious/noExplicitAny: test projection
			any
		>;
		expect(status.execution.isolation).toBe("in-process-direct");
		expect(status.execution.development).toBe(true);
	});
});

describe("connector management wire methods", () => {
	class FakeWireAdapter {
		readonly kind = "telegram";
		readonly maxMessageLength = 4096;
		readonly replies: { conversation: string; text: string }[] = [];

		async run(context: { signal: AbortSignal }): Promise<void> {
			await new Promise<void>((resolve) => {
				context.signal.addEventListener("abort", () => resolve());
			});
		}

		createReplyPort() {
			return {
				reply: async (
					conversation: { externalConversationId: string },
					text: string,
				) => {
					this.replies.push({
						conversation: conversation.externalConversationId,
						text,
					});
					return { externalMessageIds: ["wire-1"] };
				},
			};
		}

		async testCredentials() {
			return { ok: true, detail: "@fake_bot" };
		}
	}

	it("registers, inspects, configures, tests, disables, and removes a connector", async () => {
		const adapter = new FakeWireAdapter();
		const { client, botId, server } = await startServer({
			connectorAdapters: { telegram: adapter as never },
			deliveryTickMs: 25,
		});
		const registered = (await client.mutate("connector.register", {
			botId,
			kind: "telegram",
			name: "wire-connector",
			credentialRef: "wire-token",
		})) as { connectorId: string };

		// Inspect: record + live health, no credential material anywhere.
		const inspected = (await client.request("connector.inspect", {
			connectorId: registered.connectorId,
			// biome-ignore lint/suspicious/noExplicitAny: test projection
		})) as Record<string, any>;
		expect(inspected.connector.name).toBe("wire-connector");
		expect(inspected.health.running).toBe(true);
		expect(inspected.health.hasCredential).toBe(true);
		expect(JSON.stringify(inspected)).not.toContain("wire-token-value");

		// Credential probe (fake adapter answers without network).
		const check = (await client.request("connector.testCredentials", {
			connectorId: registered.connectorId,
		})) as { ok: boolean; detail?: string };
		expect(check).toEqual({ ok: true, detail: "@fake_bot" });

		// Non-secret config updates work; secret-like keys are refused.
		await client.mutate("connector.updateConfig", {
			connectorId: registered.connectorId,
			config: { botUsername: "wire_bot" },
		});
		await expect(
			client.mutate("connector.updateConfig", {
				connectorId: registered.connectorId,
				config: { botToken: "123:abc" },
			}),
		).rejects.toThrow(/credential material/);

		// Replace the credential REFERENCE (never the secret itself).
		const updated = (await client.mutate("connector.setCredential", {
			connectorId: registered.connectorId,
			credentialRef: "wire-token-v2",
		})) as { credentialRef?: string };
		expect(updated.credentialRef).toBe("wire-token-v2");

		// Send a test message; the delivery worker posts it via the adapter.
		(await client.mutate("connector.sendTest", {
			connectorId: registered.connectorId,
			externalConversationId: "chat-42",
			text: "hello from the operator",
		})) as { outbound: { outboundId: string } };
		await waitFor(() =>
			adapter.replies.some(
				(reply) =>
					reply.conversation === "chat-42" &&
					reply.text === "hello from the operator",
			),
		);
		const outbound = (await client.request("connector.outbound", {
			connectorId: registered.connectorId,
		})) as { messages: { state: string; origin: string }[] };
		expect(outbound.messages[0]).toMatchObject({
			state: "delivered",
			origin: "test",
		});

		// Disable stops the worker; enable restarts it.
		await client.mutate("connector.setEnabled", {
			connectorId: registered.connectorId,
			enabled: false,
		});
		const disabled = (await client.request("connector.inspect", {
			connectorId: registered.connectorId,
			// biome-ignore lint/suspicious/noExplicitAny: test projection
		})) as Record<string, any>;
		expect(disabled.connector.status).toBe("disabled");
		expect(disabled.health.running).toBe(false);
		await client.mutate("connector.setEnabled", {
			connectorId: registered.connectorId,
			enabled: true,
		});

		// Routes listing (empty here) and removal.
		const routes = (await client.request("connector.routes", {
			connectorId: registered.connectorId,
		})) as { routes: unknown[] };
		expect(routes.routes).toEqual([]);
		await client.mutate("connector.remove", {
			connectorId: registered.connectorId,
		});
		const listed = (await client.request("connector.list", {})) as {
			connectors: unknown[];
		};
		expect(listed.connectors).toEqual([]);
		// The outbound history is retained after removal.
		expect(server.stores.connectorOutbound.list({})).toHaveLength(1);
	});

	it("run.start joins an explicit session over the wire", async () => {
		const { client, botId, server } = await startServer();
		const first = (await client.mutate("run.start", {
			botId,
			prompt: "canonical one",
		})) as { runId: string };
		const sessionId = server.stores.runs.get(first.runId as never)?.sessionId;
		const joined = (await client.mutate("run.start", {
			botId,
			prompt: "same session please",
			sessionId,
		})) as { runId: string };
		expect(server.stores.runs.get(joined.runId as never)?.sessionId).toBe(
			sessionId,
		);
		await expect(
			client.mutate("run.start", {
				botId,
				prompt: "nope",
				sessionId: "ses_doesnotexist0001",
			}),
		).rejects.toThrow(/Unknown session/);
	});
});

describe("connector and schedule wire methods", () => {
	it("registers and lists bot-scoped connectors over the wire", async () => {
		const { client, botId, server } = await startServer({
			// No adapter for "telegram" is exercised: auto-start is disabled
			// so no real polling begins in this test.
			autoStartConnectors: false,
		});
		const registered = (await client.mutate("connector.register", {
			botId,
			kind: "telegram",
			name: "team-telegram",
			config: { botUsername: "team_bot" },
			credentialRef: "telegram-token",
		})) as { connectorId: string; botId: string; status: string };
		expect(registered.connectorId).toMatch(/^con_/);
		expect(registered.botId).toBe(botId);
		expect(registered.status).toBe("enabled");

		const listed = (await client.request("connector.list", { botId })) as {
			connectors: { connectorId: string; credentialRef?: string }[];
		};
		expect(listed.connectors).toHaveLength(1);
		// The wire record names the credential file, never its content.
		expect(listed.connectors[0].credentialRef).toBe("telegram-token");
		expect(server.stores.connectors.list()).toHaveLength(1);
	});

	it("creates schedules over the wire and reports their jobs", async () => {
		const { client, botId, server } = await startServer();
		const schedule = (await client.mutate("schedule.create", {
			botId,
			name: "wire-schedule",
			prompt: "do the thing",
			intervalMs: 30,
		})) as { scheduleId: string };
		expect(schedule.scheduleId).toMatch(/^sch_/);

		// The scheduler timer fires, admits an ordinary automation run, and
		// the job report settles as completed (scripted engine).
		await waitFor(
			() =>
				server.stores.scheduleJobs
					.report(schedule.scheduleId as never)
					.some((job) => job.state === "completed"),
			{ timeoutMs: 10_000 },
		);
		const report = (await client.request("schedule.report", {
			scheduleId: schedule.scheduleId,
		})) as { jobs: { state: string; runId?: string }[] };
		const completed = report.jobs.find((job) => job.state === "completed");
		expect(completed?.runId).toMatch(/^run_/);
		if (!completed?.runId) {
			throw new Error("no run");
		}
		expect(
			server.runtime.runProvenance(completed.runId as never),
		).toMatchObject({
			mode: "automation",
			scheduleId: schedule.scheduleId,
		});

		const listed = (await client.request("schedule.list", {})) as {
			schedules: { scheduleId: string }[];
		};
		expect(listed.schedules.map((entry) => entry.scheduleId)).toContain(
			schedule.scheduleId,
		);
	});

	it("rejects a schedule with zero or two triggers", async () => {
		const { client, botId } = await startServer();
		await expect(
			client.mutate("schedule.create", {
				botId,
				name: "broken",
				prompt: "x",
			}),
		).rejects.toThrow(/exactly one trigger/);
		await expect(
			client.mutate("schedule.create", {
				botId,
				name: "broken",
				prompt: "x",
				intervalMs: 1_000,
				at: Date.now(),
			}),
		).rejects.toThrow(/exactly one trigger/);
	});
});
