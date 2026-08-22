import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createGatewayInstanceId } from "@cline/shared/gateway";
import { afterEach, describe, expect, it } from "vitest";
import { openGatewayDatabase } from "./db";
import {
	GatewayExtensionStore,
	type GatewayMarketplaceEntry,
	MCP_OAUTH_UNAVAILABLE_MESSAGE,
	MCP_REDACTED_VALUE,
} from "./managed-extensions";
import { ensureGatewayDataDir, resolveGatewayPaths } from "./paths";
import { type CatalogReloadReport, PluginCatalog } from "./plugins/catalog";
import { loadPlugin } from "./plugins/loader";
import { AGENT_PLUGIN_SCHEMA_1_0_0 } from "./plugins/manifest";
import { GatewayRuntime } from "./runtime";
import { createGatewayStores } from "./stores";
import { ScriptedEnginePort, tempDataRoot, waitFor } from "./test-support";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

const pluginEntry: GatewayMarketplaceEntry = {
	id: "test-plugin",
	type: "plugin",
	name: "Test Plugin",
	install: { args: ["test-plugin"] },
};

function writeMcpPlugin(destination: string): void {
	mkdirSync(destination, { recursive: true });
	writeFileSync(
		join(destination, "plugin.json"),
		JSON.stringify({
			$schema: AGENT_PLUGIN_SCHEMA_1_0_0,
			name: "test.gateway.plugin",
		}),
	);
	writeFileSync(
		join(destination, "mcp.json"),
		JSON.stringify({
			mcpServers: {
				discoverable: { url: "https://example.com/mcp" },
			},
		}),
	);
}

function setup() {
	const dataRoot = tempDataRoot("gateway-extensions-");
	roots.push(dataRoot);
	const paths = resolveGatewayPaths({ dataRoot, namespace: "test" });
	ensureGatewayDataDir(paths);
	const plugins = new PluginCatalog({
		sources: [{ scope: { kind: "global" }, dir: paths.pluginsDir }],
	});
	expect(plugins.reload().ok).toBe(true);
	const extensions = new GatewayExtensionStore({
		paths,
		plugins,
		loadCatalog: async () => ({ entries: [pluginEntry] }),
		materializePackage: async (_entry, destination) => {
			writeMcpPlugin(destination);
		},
	});
	return { dataRoot, paths, plugins, extensions };
}

describe("Gateway-owned MCP settings", () => {
	it("keeps secrets out of settings and client projections", () => {
		const { paths, extensions } = setup();
		const response = extensions.putMcpServer({
			name: "local-tools",
			transportType: "stdio",
			command: "bun",
			args: ["run", "server.ts"],
			env: { API_TOKEN: "super-secret-token" },
		});

		expect(response.servers[0].env).toEqual({
			API_TOKEN: MCP_REDACTED_VALUE,
		});
		expect(response.capabilities.oauth).toEqual({
			supported: false,
			reason: MCP_OAUTH_UNAVAILABLE_MESSAGE,
		});
		expect(readFileSync(extensions.mcpSettingsFile, "utf8")).not.toContain(
			"super-secret-token",
		);
		const secretFiles = readdirSync(paths.secretsDir);
		expect(secretFiles).toHaveLength(1);
		expect(statSync(join(paths.secretsDir, secretFiles[0])).mode & 0o777).toBe(
			0o600,
		);
		expect(extensions.listExecutableMcpDefinitions()).toEqual([
			{
				name: "settings/local-tools",
				transport: {
					kind: "stdio",
					command: "bun",
					args: ["run", "server.ts"],
					env: { API_TOKEN: "super-secret-token" },
				},
			},
		]);

		extensions.putMcpServer({
			name: "local-tools",
			previousName: "local-tools",
			transportType: "stdio",
			command: "bun",
			env: { API_TOKEN: MCP_REDACTED_VALUE },
		});
		expect(
			extensions.listExecutableMcpDefinitions()[0].transport,
		).toMatchObject({ env: { API_TOKEN: "super-secret-token" } });
	});

	it("persists legacy SSE but only projects executable stdio and HTTP servers", () => {
		const { extensions } = setup();
		extensions.putMcpServer({
			name: "legacy",
			transportType: "sse",
			url: "https://example.com/sse",
		});
		extensions.putMcpServer({
			name: "remote",
			transportType: "streamableHttp",
			url: "https://example.com/mcp",
			headers: { Authorization: "Bearer secret" },
		});
		const listed = extensions.listMcpServers();
		expect(listed.servers.find(({ name }) => name === "legacy")).toHaveProperty(
			"configurationError",
		);
		expect(extensions.listExecutableMcpDefinitions()).toEqual([
			{
				name: "settings/remote",
				transport: {
					kind: "http",
					url: "https://example.com/mcp",
					headers: { Authorization: "Bearer secret" },
				},
			},
		]);
	});
});

describe("atomic managed-plugin mutations", () => {
	it("restores state, files, and catalog policy when reload fails", async () => {
		const { paths, plugins, extensions } = setup();
		const originalReload = plugins.reload.bind(plugins);
		let rejectReload = true;
		plugins.reload = (): CatalogReloadReport =>
			rejectReload
				? {
						ok: false,
						generation: plugins.current.generation,
						imported: [],
						reused: [],
						diagnostics: [],
						error: "injected reload failure",
					}
				: originalReload();

		await expect(
			extensions.installMarketplace({ type: "plugin", id: "test-plugin" }),
		).rejects.toThrow("injected reload failure");
		expect(existsSync(extensions.stateFile)).toBe(false);
		expect(readdirSync(paths.pluginsDir)).toEqual([]);
		expect(plugins.current.entries).toEqual([]);

		rejectReload = false;
		await extensions.installMarketplace({ type: "plugin", id: "test-plugin" });
		const plugin = extensions.listManagedExtensions().plugins[0];
		expect(plugin.enabled).toBe(true);
		expect(existsSync(plugin.path)).toBe(true);
		expect(plugins.current.entries).toHaveLength(1);

		rejectReload = true;
		expect(() => extensions.setPluginDisabled(plugin.path, true)).toThrow(
			"injected reload failure",
		);
		expect(extensions.listManagedExtensions().plugins[0].enabled).toBe(true);
		expect(plugins.current.entries).toHaveLength(1);

		expect(() =>
			extensions.uninstallLocal({ type: "plugin", path: plugin.path }),
		).toThrow("injected reload failure");
		expect(existsSync(plugin.path)).toBe(true);
		expect(extensions.listManagedExtensions().plugins[0].enabled).toBe(true);
	});
});

describe("runtime managed-plugin activation", () => {
	it("discovers an installed plugin on the next run and removes it after disable or uninstall", async () => {
		const { paths, plugins, extensions } = setup();
		const database = openGatewayDatabase(paths.databaseFile);
		const stores = createGatewayStores(database, createGatewayInstanceId());
		const engine = new ScriptedEnginePort();
		const runtime = new GatewayRuntime({
			database,
			stores,
			paths,
			instanceId: createGatewayInstanceId(),
			engine,
			plugins,
			extensions,
		});
		runtime.bootstrap();
		const botId = runtime.defaultBotId;
		if (!botId) throw new Error("bootstrap failed");

		await runtime.installMarketplace("desktop_test", {
			type: "plugin",
			id: "test-plugin",
		});
		const pluginPath = extensions.listManagedExtensions().plugins[0].path;
		const canonicalPluginPath = realpathSync(pluginPath);
		const firstSession = runtime.createSession("desktop_test", {
			botId,
			kind: "dedicated",
		});
		const first = runtime.startRun("desktop_test", {
			botId,
			sessionId: firstSession.sessionId,
			prompt: "first",
		});
		expect(engine.handles[0].invocation.pluginRoots).toContain(
			canonicalPluginPath,
		);
		const loaded = loadPlugin(
			engine.handles[0].invocation.pluginRoots?.find(
				(root) => root === canonicalPluginPath,
			) ?? "",
		);
		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.plugin.mcpServers.map(({ name }) => name)).toEqual([
				"discoverable",
			]);
		}
		engine.handles[0].settle();
		await waitFor(() => stores.runs.get(first.runId)?.state === "completed");

		runtime.setPluginDisabled("desktop_test", pluginPath, true);
		const secondSession = runtime.createSession("desktop_test", {
			botId,
			kind: "dedicated",
		});
		const second = runtime.startRun("desktop_test", {
			botId,
			sessionId: secondSession.sessionId,
			prompt: "second",
		});
		expect(engine.handles[1].invocation.pluginRoots ?? []).not.toContain(
			canonicalPluginPath,
		);
		engine.handles[1].settle();
		await waitFor(() => stores.runs.get(second.runId)?.state === "completed");

		runtime.setPluginDisabled("desktop_test", pluginPath, false);
		await runtime.uninstallMarketplace("desktop_test", {
			type: "plugin",
			id: "test-plugin",
		});
		const thirdSession = runtime.createSession("desktop_test", {
			botId,
			kind: "dedicated",
		});
		const third = runtime.startRun("desktop_test", {
			botId,
			sessionId: thirdSession.sessionId,
			prompt: "third",
		});
		expect(engine.handles[2].invocation.pluginRoots ?? []).not.toContain(
			canonicalPluginPath,
		);
		engine.handles[2].settle();
		await waitFor(() => stores.runs.get(third.runId)?.state === "completed");
		database.close();
	});
});
