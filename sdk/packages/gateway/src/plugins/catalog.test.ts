/**
 * Plugin catalog generations and session bindings (Gateway RFC, Phase 4):
 * atomic publication, no re-import of unchanged plugins, failed-reload
 * rollback to the prior healthy generation, generation pinning by active
 * runs, policy-filtered session views, session-state isolation (no
 * context leakage), and durable state through the Gateway storage port.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	createBotId,
	createGatewayInstanceId,
	createPrincipalId,
	createSessionId,
} from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import { openGatewayDatabase } from "../db";
import { ensureGatewayDataDir, resolveGatewayPaths } from "../paths";
import { createGatewayStores } from "../stores";
import { tempDataRoot } from "../test-support";
import { createSessionPluginView } from "./bindings";
import { PluginCatalog, type PluginSource } from "./catalog";
import { AGENT_PLUGIN_SCHEMA_1_0_0 } from "./manifest";
import { PluginStateStore } from "./state-store";

function writePluginPackage(
	sourceDir: string,
	dirName: string,
	name: string,
	options: { skillDescription?: string; invalid?: boolean } = {},
): string {
	const root = join(sourceDir, dirName);
	mkdirSync(root, { recursive: true });
	writeFileSync(
		join(root, "plugin.json"),
		options.invalid
			? JSON.stringify({ name })
			: JSON.stringify({ $schema: AGENT_PLUGIN_SCHEMA_1_0_0, name }),
	);
	const skillDir = join(root, "skills", "main");
	mkdirSync(skillDir, { recursive: true });
	writeFileSync(
		join(skillDir, "SKILL.md"),
		`---\nname: main\ndescription: ${options.skillDescription ?? "the main skill"}\n---\n`,
	);
	return root;
}

function createCatalog(sources: PluginSource[]): PluginCatalog {
	let now = 1_000;
	return new PluginCatalog({ sources, clock: () => (now += 1) });
}

describe("catalog generations", () => {
	it("publishes atomically and does not re-import unchanged plugins", () => {
		const sourceDir = tempDataRoot("cline-catalog-");
		writePluginPackage(sourceDir, "one", "plugin.one");
		writePluginPackage(sourceDir, "two", "plugin.two");
		const catalog = createCatalog([
			{ scope: { kind: "global" }, dir: sourceDir },
		]);

		const first = catalog.reload();
		expect(first.ok).toBe(true);
		expect(first.imported).toHaveLength(2);
		expect(catalog.importCount).toBe(2);
		const firstEntries = catalog.current.entries;

		// Nothing changed: reload publishes a new generation but re-imports
		// nothing — the previous generation's frozen entries are reused.
		const second = catalog.reload();
		expect(second.ok).toBe(true);
		expect(second.imported).toHaveLength(0);
		expect(second.reused).toHaveLength(2);
		expect(catalog.importCount).toBe(2);
		expect(catalog.current.entries[0]).toBe(firstEntries[0]);
		expect(catalog.current.entries[1]).toBe(firstEntries[1]);

		// A content change re-imports exactly the changed plugin.
		writePluginPackage(sourceDir, "one", "plugin.one", {
			skillDescription: "changed",
		});
		const third = catalog.reload();
		expect(third.imported).toHaveLength(1);
		expect(third.reused).toHaveLength(1);
		expect(catalog.importCount).toBe(3);
	});

	it("isolates an invalid plugin without failing the generation", () => {
		const sourceDir = tempDataRoot("cline-catalog-");
		writePluginPackage(sourceDir, "good", "plugin.good");
		writePluginPackage(sourceDir, "bad", "plugin.bad", { invalid: true });
		const catalog = createCatalog([
			{ scope: { kind: "global" }, dir: sourceDir },
		]);
		const report = catalog.reload();
		expect(report.ok).toBe(true);
		expect(catalog.current.entries).toHaveLength(1);
		expect(catalog.current.entries[0].plugin.manifest.name).toBe("plugin.good");
		expect(
			report.diagnostics.some(
				(diag) => diag.code === "manifest.schema_missing",
			),
		).toBe(true);
	});

	it("keeps the prior healthy generation when a reload fails", () => {
		const sourceDir = tempDataRoot("cline-catalog-");
		writePluginPackage(sourceDir, "one", "plugin.one");
		const catalog = createCatalog([
			{ scope: { kind: "global" }, dir: sourceDir },
		]);
		const healthy = catalog.reload();
		expect(healthy.ok).toBe(true);
		const healthySnapshot = catalog.current;

		// Sabotage the next reconciliation with a throwing source scan.
		writePluginPackage(sourceDir, "one", "plugin.one", {
			skillDescription: "changed so the entry must re-import",
		});
		const originalLoad = Object.getOwnPropertyDescriptor(catalog, "sources");
		void originalLoad;
		rmSync(join(sourceDir, "one", "plugin.json"));
		// Deleting plugin.json makes the plugin invalid (isolated), not a
		// failed reload — so force a real failure through a poisoned source.
		catalog.setSources([
			{ scope: { kind: "global" }, dir: sourceDir },
			{
				scope: { kind: "global" },
				get dir(): string {
					throw new Error("disk exploded");
				},
			} as unknown as PluginSource,
		]);
		const failed = catalog.reload();
		expect(failed.ok).toBe(false);
		expect(failed.error).toContain("disk exploded");
		expect(
			failed.diagnostics.some((diag) => diag.code === "catalog.reload_failed"),
		).toBe(true);
		// The prior healthy generation keeps serving, identically.
		expect(catalog.current).toBe(healthySnapshot);
		expect(catalog.lastReloadReport?.ok).toBe(false);
	});

	it("pins generations for active runs across later publishes", () => {
		const sourceDir = tempDataRoot("cline-catalog-");
		writePluginPackage(sourceDir, "one", "plugin.one");
		const catalog = createCatalog([
			{ scope: { kind: "global" }, dir: sourceDir },
		]);
		catalog.reload();
		const pinned = catalog.pin();
		const pinnedGeneration = pinned.snapshot.generation;

		writePluginPackage(sourceDir, "one", "plugin.one", {
			skillDescription: "v2",
		});
		catalog.reload();
		writePluginPackage(sourceDir, "one", "plugin.one", {
			skillDescription: "v3",
		});
		catalog.reload();

		// The pinned generation object is retained and unchanged.
		expect(catalog.heldGenerations()).toContain(pinnedGeneration);
		expect(pinned.snapshot.entries[0].plugin.skills[0].description).toBe(
			"the main skill",
		);
		expect(catalog.current.generation).not.toBe(pinnedGeneration);

		pinned.release();
		expect(catalog.heldGenerations()).not.toContain(pinnedGeneration);
		// Releasing twice is harmless.
		pinned.release();
	});
});

describe("session plugin bindings", () => {
	function setup() {
		const globalDir = tempDataRoot("cline-catalog-global-");
		const botDir = tempDataRoot("cline-catalog-bot-");
		writePluginPackage(globalDir, "shared", "shared.tools");
		writePluginPackage(botDir, "mine", "bot.tools");
		const botId = createBotId();
		const otherBotId = createBotId();
		const catalog = createCatalog([
			{ scope: { kind: "global" }, dir: globalDir },
			{ scope: { kind: "bot", botId }, dir: botDir },
		]);
		catalog.reload();
		return { catalog, botId, otherBotId };
	}

	it("filters by scope: bots only see global + their own plugins", () => {
		const { catalog, botId, otherBotId } = setup();
		const mine = createSessionPluginView(catalog.current, {
			botId,
			sessionId: createSessionId(),
		});
		expect(mine.plugins.map((plugin) => plugin.name).sort()).toEqual([
			"bot.tools",
			"shared.tools",
		]);
		const theirs = createSessionPluginView(catalog.current, {
			botId: otherBotId,
			sessionId: createSessionId(),
		});
		expect(theirs.plugins.map((plugin) => plugin.name)).toEqual([
			"shared.tools",
		]);
	});

	it("applies the permission policy to plugins and components", () => {
		const { catalog, botId } = setup();
		const view = createSessionPluginView(catalog.current, {
			botId,
			sessionId: createSessionId(),
			principalId: createPrincipalId(),
			policy: {
				allowPlugin: (entry) => entry.plugin.manifest.name !== "bot.tools",
				allowSkill: () => false,
			},
		});
		expect(view.plugins.map((plugin) => plugin.name)).toEqual(["shared.tools"]);
		expect(view.plugins[0].skills).toEqual([]);
	});

	it("keeps mutable state session-scoped: no context leakage", () => {
		const { catalog, botId } = setup();
		const sessionA = createSessionPluginView(catalog.current, {
			botId,
			sessionId: createSessionId(),
		});
		const sessionB = createSessionPluginView(catalog.current, {
			botId,
			sessionId: createSessionId(),
		});
		const pluginA = sessionA.plugins.find((p) => p.name === "shared.tools");
		const pluginB = sessionB.plugins.find((p) => p.name === "shared.tools");
		pluginA?.sessionState.set("secret", "session-a-only");
		expect(pluginB?.sessionState.has("secret")).toBe(false);
		// The underlying catalog entries are frozen and shared; the state
		// containers are not.
		expect(pluginA?.manifest).toBe(pluginB?.manifest);
		expect(pluginA?.sessionState).not.toBe(pluginB?.sessionState);
	});

	it("routes durable state through the namespaced Gateway storage port", () => {
		const { catalog, botId, otherBotId } = setup();
		const dataRoot = tempDataRoot();
		const paths = resolveGatewayPaths({ dataRoot, namespace: "default" });
		ensureGatewayDataDir(paths);
		const database = openGatewayDatabase(paths.databaseFile);
		createGatewayStores(database, createGatewayInstanceId());
		const stateStore = new PluginStateStore(database);

		const view = createSessionPluginView(catalog.current, {
			botId,
			sessionId: createSessionId(),
			stateStore,
		});
		const plugin = view.plugins.find((p) => p.name === "bot.tools");
		plugin?.storage?.set("counter", 42);
		expect(plugin?.storage?.get("counter")).toBe(42);
		expect(plugin?.storage?.keys()).toEqual(["counter"]);

		// Another plugin (or another scope) cannot see the value.
		expect(
			stateStore.get("shared.tools", `bot:${botId}`, "counter"),
		).toBeUndefined();
		expect(
			stateStore.get("bot.tools", `bot:${otherBotId}`, "counter"),
		).toBeUndefined();
		expect(stateStore.get("bot.tools", `bot:${botId}`, "counter")).toBe(42);
		database.close();
	});
});
