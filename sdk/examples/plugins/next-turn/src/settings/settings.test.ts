import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextTurnPaths, resolveClineDataDir } from "../store/data-dir";
import {
	connectorRole,
	type DirectoryWatch,
	defaultSettings,
	defaultSettingsFile,
	effectiveSettings,
	loadSettingsFile,
	parseSettingsFile,
	type SettingsFile,
	saveSettingsFile,
	watchSettingsFile,
} from "./settings";

const temps: string[] = [];
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "next-turn-settings-"));
	temps.push(dir);
	return dir;
}
afterEach(() => {
	for (const dir of temps.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

describe("data directory", () => {
	test("follows Cline's resolution: CLINE_DATA_DIR, then CLINE_DIR/data, then ~/.cline/data", () => {
		expect(
			resolveClineDataDir(
				{ CLINE_DATA_DIR: "/x/data", CLINE_DIR: "/y" },
				"/home/me",
			),
		).toBe("/x/data");
		expect(resolveClineDataDir({ CLINE_DIR: "/y" }, "/home/me")).toBe(
			"/y/data",
		);
		expect(resolveClineDataDir({ CLINE_DIR: "  " }, "/home/me")).toBe(
			"/home/me/.cline/data",
		);
		expect(resolveClineDataDir({}, "/home/me")).toBe("/home/me/.cline/data");
	});

	test("keeps everything under plugins/next-turn", () => {
		const paths = nextTurnPaths("/d");
		expect(paths.root).toBe("/d/plugins/next-turn");
		expect(paths.settings).toBe("/d/plugins/next-turn/settings.json");
		expect(paths.statusDb).toBe("/d/plugins/next-turn/status.db");
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

	test("a connector with no explicit choice takes its own default", () => {
		const current = effectiveSettings(file);
		expect(connectorRole(current, "gh", "mention")).toBe("read");
		expect(connectorRole(current, "gmail", "off")).toBe("off");
	});
});

describe("on disk", () => {
	test("round-trips through an atomic, owner-only write", () => {
		const path = join(tempDir(), "nested", "settings.json");
		const file = defaultSettingsFile();
		file.everywhere.features.status = false;
		saveSettingsFile(path, file);
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

	test("another process's atomic rewrite reaches the watcher", async () => {
		const path = join(tempDir(), "settings.json");
		saveSettingsFile(path, defaultSettingsFile());
		const seen = new Promise<boolean>((resolve) => {
			const stop = watchSettingsFile(path, (file) => {
				if (file.everywhere.features.next === false) {
					stop();
					resolve(true);
				}
			});
		});
		const changed = defaultSettingsFile();
		changed.everywhere.features.next = false;
		saveSettingsFile(path, changed);
		expect(await seen).toBe(true);
		expect(
			JSON.parse(readFileSync(path, "utf8")).everywhere.features.next,
		).toBe(false);
	});

	/**
	 * Bun before 1.4 on Linux names a merged inotify batch after its first
	 * entry, so a rewrite can arrive under another file's name in the shared
	 * data directory. That first event alone must deliver the change, and the
	 * events that follow for the same text must not deliver it again.
	 */
	test("a rewrite reported under another file's name reaches the watcher once", () => {
		const path = join(tempDir(), "settings.json");
		saveSettingsFile(path, defaultSettingsFile());
		let listener: Parameters<DirectoryWatch>[1] = () => {};
		const seen: SettingsFile[] = [];
		watchSettingsFile(
			path,
			(file) => seen.push(file),
			(_directory, capture) => {
				listener = capture;
				return { close() {} };
			},
		);
		const changed = defaultSettingsFile();
		changed.everywhere.features.next = false;
		saveSettingsFile(path, changed);
		listener("rename", "status.db");
		expect(seen.map((file) => file.everywhere.features.next)).toEqual([false]);
		listener("rename", "settings.json.4242.1.tmp");
		listener("change", "settings.json");
		listener("rename", null);
		expect(seen.map((file) => file.everywhere.features.next)).toEqual([false]);
	});
});
