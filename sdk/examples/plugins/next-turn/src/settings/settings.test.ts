import { describe, expect, test } from "bun:test";
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nextTurnPaths, writeFileAtomic } from "../store/data-dir";
import { useTempDirs } from "../test-support";
import { modelChoices } from "./models";
import {
	defaultSettings,
	defaultSettingsFile,
	effectiveSettings,
	loadSettingsFile,
	parseSettingsFile,
} from "./settings";

const tempDir = useTempDirs("next-turn-settings-");

describe("data directory", () => {
	test("keeps everything under plugins/next-turn", () => {
		const paths = nextTurnPaths("/d");
		expect(paths.root).toBe("/d/plugins/next-turn");
		expect(paths.settings).toBe("/d/plugins/next-turn/settings.json");
		expect(paths.labels).toBe("/d/plugins/next-turn/labels.jsonl");
	});
});

describe("parsing", () => {
	test("anything that is not this schema version reads as defaults", () => {
		expect(parseSettingsFile(null)).toEqual(defaultSettingsFile());
		expect(
			parseSettingsFile({
				version: 99,
				everywhere: { features: { next: false } },
			}),
		).toEqual(defaultSettingsFile());
	});

	test("keeps valid values, drops unknown keys and wrong types", () => {
		const file = parseSettingsFile({
			version: 1,
			everywhere: {
				features: { next: false, tasks: "yes", bogus: true },
				connectors: {
					gh: { role: "read", scopes: ["pr", "pr", 3] },
					slack: { role: "shout" },
					"": { role: "off" },
				},
				planner: {
					model: { kind: "model", providerId: "anthropic", modelId: "fast" },
					callsPerHour: -2,
				},
			},
		});
		expect(file.everywhere.features).toEqual({
			next: false,
			tasks: true,
			status: true,
		});
		expect(file.everywhere.connectors).toEqual({
			gh: { role: "read", scopes: ["pr"] },
		});
		expect(file.everywhere.planner.model).toEqual({
			kind: "model",
			providerId: "anthropic",
			modelId: "fast",
		});
		expect(file.everywhere.planner.callsPerHour).toBe(
			defaultSettings().planner.callsPerHour,
		);
	});

	test("pinned reads parse leniently: ids unique, a tool required, arguments an object", () => {
		const file = parseSettingsFile({
			version: 1,
			everywhere: {
				connectors: {
					"mcp:linear": {
						role: "read",
						scopes: ["a"],
						reads: [
							{
								id: "a",
								tool: "list_issues",
								arguments: { team: "core" },
								label: " Mine ",
							},
							{ id: "a", tool: "list_other" },
							{ id: "b" },
							{ id: "c", tool: "search", arguments: "nope" },
						],
					},
				},
			},
		});
		expect(file.everywhere.connectors["mcp:linear"]?.reads).toEqual([
			{
				id: "a",
				tool: "list_issues",
				arguments: { team: "core" },
				label: "Mine",
			},
			{ id: "c", tool: "search", arguments: {} },
		]);
	});
});

describe("workspace overrides", () => {
	const file = parseSettingsFile({
		version: 1,
		everywhere: {
			connectors: {
				gh: { role: "read", scopes: ["pr"] },
				linear: { role: "mention", scopes: [] },
			},
		},
		workspaces: {
			"/work/client-repo": {
				connectors: { gh: { role: "mention", scopes: [] } },
				context: { history: false },
			},
			"/work/empty": {},
		},
	});

	test("a workspace overrides only what it names", () => {
		const client = effectiveSettings(file, "/work/client-repo");
		expect(client.connectors.gh?.role).toBe("mention");
		expect(client.connectors.linear?.role).toBe("mention");
		expect(client.context.history).toBe(false);
		expect(client.context.repo).toBe(true);
	});

	test("other workspaces, and empty overrides, get everywhere", () => {
		expect(effectiveSettings(file, "/work/other")).toEqual(file.everywhere);
		expect(file.workspaces["/work/empty"]).toBeUndefined();
	});
});

describe("on disk", () => {
	test("round-trips through an atomic, owner-only write", () => {
		const path = join(tempDir(), "nested", "settings.json");
		const file = defaultSettingsFile();
		file.everywhere.features.status = false;
		writeFileAtomic(path, JSON.stringify(file));
		expect(loadSettingsFile(path)).toEqual(file);
		expect(statSync(path).mode & 0o777).toBe(0o600);
	});

	test("a missing or corrupt file reads as defaults", () => {
		const dir = tempDir();
		expect(loadSettingsFile(join(dir, "none.json"))).toEqual(
			defaultSettingsFile(),
		);
		writeFileSync(join(dir, "bad.json"), "{not json");
		expect(loadSettingsFile(join(dir, "bad.json"))).toEqual(
			defaultSettingsFile(),
		);
	});
});

describe("model choices", () => {
	test("provider and model ids only, last used first; keys never leave", () => {
		const stored = {
			version: 1,
			lastUsedProvider: "openai",
			providers: {
				anthropic: {
					settings: {
						provider: "anthropic",
						model: "claude-sonnet",
						apiKey: "SECRET",
					},
				},
				openai: {
					settings: { provider: "openai", auth: { accessToken: "SECRET" } },
				},
			},
		};
		const choices = modelChoices(stored);
		expect(choices).toEqual([
			{ providerId: "openai", modelId: undefined, lastUsed: true },
			{ providerId: "anthropic", modelId: "claude-sonnet", lastUsed: false },
		]);
		expect(JSON.stringify(choices)).not.toContain("SECRET");
		expect(modelChoices(null)).toEqual([]);
	});
});
