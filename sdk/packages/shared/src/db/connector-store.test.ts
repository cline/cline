import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteConnectorStore } from "./connector-store";

describe("SqliteConnectorStore", () => {
	const previousDataDir = process.env.CLINE_DATA_DIR;
	const previousSettingsPath = process.env.CLINE_CONNECTOR_SETTINGS_PATH;
	const previousDbPath = process.env.CLINE_CONNECTORS_DB_PATH;
	const tempRoots: string[] = [];

	afterEach(() => {
		process.env.CLINE_DATA_DIR = previousDataDir;
		process.env.CLINE_CONNECTOR_SETTINGS_PATH = previousSettingsPath;
		process.env.CLINE_CONNECTORS_DB_PATH = previousDbPath;
		if (previousDataDir === undefined) delete process.env.CLINE_DATA_DIR;
		if (previousSettingsPath === undefined)
			delete process.env.CLINE_CONNECTOR_SETTINGS_PATH;
		if (previousDbPath === undefined)
			delete process.env.CLINE_CONNECTORS_DB_PATH;
		for (const root of tempRoots.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	function useTempDataDir(): string {
		const root = mkdtempSync(join(tmpdir(), "connector-store-"));
		tempRoots.push(root);
		process.env.CLINE_DATA_DIR = root;
		delete process.env.CLINE_CONNECTOR_SETTINGS_PATH;
		delete process.env.CLINE_CONNECTORS_DB_PATH;
		return root;
	}

	function withStore<T>(fn: (store: SqliteConnectorStore) => T): T {
		const store = new SqliteConnectorStore();
		try {
			return fn(store);
		} finally {
			store.close();
		}
	}

	it("upserts and reads connector configuration", () => {
		useTempDataDir();
		withStore((store) => {
			store.upsertConfig({
				channel: "telegram",
				values: { "-k": "123:token" },
				security: { enabled: true, values: { userId: "42" } },
			});
			const record = store.getConfig("telegram");
			expect(record?.type).toBe("telegram");
			expect(record?.values).toEqual({ "-k": "123:token" });
			expect(record?.security).toEqual({
				enabled: true,
				values: { userId: "42" },
			});
		});
	});

	it("refreshes stored launch args while preserving autostart state", () => {
		useTempDataDir();
		withStore((store) => {
			store.recordConnected("telegram", "cline_bot", ["-k", "123:token"]);
			store.setEnabled("telegram", false);
			store.upsertConfig({
				channel: "telegram",
				values: { "-k": "456:rotated" },
			});
			expect(store.getConnection("telegram", "cline_bot")?.connectArgs).toEqual(
				["-k", "123:token"],
			);
			store.upsertConfig({
				channel: "telegram",
				values: { "-k": "456:rotated" },
				updateConnectArgs: () => ["-k", "456:rotated"],
			});
			expect(store.getConfig("telegram")?.values).toEqual({
				"-k": "456:rotated",
			});
			const connection = store.getConnection("telegram", "cline_bot");
			expect(connection?.connectArgs).toEqual(["-k", "456:rotated"]);
			expect(connection?.lastSuccessfulArgs).toEqual(["-k", "123:token"]);
			expect(connection?.enabled).toBe(false);
		});
	});

	it("records each instance independently and re-enables only the restarted one", () => {
		useTempDataDir();
		withStore((store) => {
			store.recordConnected("slack", "workspace-a", [
				"--bot-token",
				"xoxb",
				"--app-token",
				"xapp",
			]);
			store.recordConnected("slack", "workspace-b", [
				"--bot-token",
				"xoxb-other",
			]);
			expect(store.getConfig("slack")).toBeUndefined();
			expect(store.listConnections("slack")).toHaveLength(2);

			store.setEnabled("slack", false);
			expect(
				store.listConnections("slack").every((entry) => !entry.enabled),
			).toBe(true);

			store.recordConnected("slack", "workspace-a", ["--bot-token", "xoxb2"]);
			expect(store.getConnection("slack", "workspace-a")).toEqual(
				expect.objectContaining({
					enabled: true,
					connectArgs: ["--bot-token", "xoxb2"],
				}),
			);
			expect(store.getConnection("slack", "workspace-b")?.enabled).toBe(false);
		});
	});

	it("round-trips empty connect args for env-only starts", () => {
		useTempDataDir();
		withStore((store) => {
			store.recordConnected("telegram", "cline_bot", []);

			expect(store.getConnection("telegram", "cline_bot")?.connectArgs).toEqual(
				[],
			);
			expect(store.getConnection("telegram", "cline_bot")?.enabled).toBe(true);
		});
	});

	it("disables autostart for all connectors", () => {
		useTempDataDir();
		withStore((store) => {
			store.recordConnected("slack", "workspace", ["--bot-token", "xoxb"]);
			store.recordConnected("telegram", "cline_bot", ["-k", "123:token"]);
			store.disableAll();
			expect(store.listConnections().every((entry) => !entry.enabled)).toBe(
				true,
			);
		});
	});

	it("deletes dashboard config without clearing CLI autostart state", () => {
		useTempDataDir();
		withStore((store) => {
			store.recordConnected("telegram", "cline_bot", ["-k", "123:token"]);
			store.upsertConfig({
				channel: "telegram",
				values: { "-k": "123:token" },
				security: { enabled: true, values: { userId: "42" } },
			});

			expect(store.deleteConfig("telegram")).toBe(true);
			expect(store.getConfig("telegram")).toBeUndefined();
			expect(store.getConnection("telegram", "cline_bot")).toEqual(
				expect.objectContaining({
					channel: "telegram",
					instanceId: "cline_bot",
					connectArgs: ["-k", "123:token"],
					enabled: true,
				}),
			);
			expect(store.deleteConfig("telegram")).toBe(false);
		});
	});

	it("removes config-only rows when dashboard config is deleted", () => {
		useTempDataDir();
		withStore((store) => {
			store.upsertConfig({
				channel: "telegram",
				values: { "-k": "123:token" },
			});

			expect(store.deleteConfig("telegram")).toBe(true);
			expect(store.getConfig("telegram")).toBeUndefined();
		});
	});

	it("saves channel-wide config without rewriting ambiguous instance args", () => {
		useTempDataDir();
		withStore((store) => {
			store.recordConnected("telegram", "first_bot", ["-k", "first:token"]);
			store.recordConnected("telegram", "second_bot", ["-k", "second:token"]);

			store.upsertConfig({
				channel: "telegram",
				values: { "-k": "replacement:token" },
				updateConnectArgs: () => ["-k", "replacement:token"],
			});

			expect(store.getConfig("telegram")?.values).toEqual({
				"-k": "replacement:token",
			});
			expect(
				store.listConnections("telegram").map((entry) => entry.connectArgs),
			).toEqual([
				["-k", "first:token"],
				["-k", "second:token"],
			]);
		});
	});

	it("imports the legacy JSON settings file once and renames it", () => {
		const root = useTempDataDir();
		const legacyPath = join(root, "connectors", "settings.json");
		mkdirSync(dirname(legacyPath), { recursive: true });
		writeFileSync(
			legacyPath,
			JSON.stringify({
				version: 1,
				connectors: {
					telegram: {
						type: "telegram",
						values: { "-k": "123:legacy-token" },
						security: { enabled: true, values: { userId: "7" } },
						configuredAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-02T00:00:00.000Z",
					},
				},
			}),
			"utf8",
		);

		withStore((store) => {
			const record = store.getConfig("telegram");
			expect(record?.values).toEqual({ "-k": "123:legacy-token" });
			expect(record?.security).toEqual({
				enabled: true,
				values: { userId: "7" },
			});
			expect(record?.configuredAt).toBe("2026-01-01T00:00:00.000Z");
		});

		expect(existsSync(legacyPath)).toBe(false);
		expect(existsSync(`${legacyPath}.migrated`)).toBe(true);
	});

	it("does not overwrite existing rows during legacy import", () => {
		const root = useTempDataDir();
		withStore((store) => {
			store.upsertConfig({
				channel: "telegram",
				values: { "-k": "123:current" },
			});
		});

		const legacyPath = join(root, "connectors", "settings.json");
		mkdirSync(dirname(legacyPath), { recursive: true });
		writeFileSync(
			legacyPath,
			JSON.stringify({
				version: 1,
				connectors: {
					telegram: {
						type: "telegram",
						values: { "-k": "999:stale" },
						configuredAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-01T00:00:00.000Z",
					},
				},
			}),
			"utf8",
		);

		withStore((store) => {
			expect(store.getConfig("telegram")?.values).toEqual({
				"-k": "123:current",
			});
		});
	});
});
