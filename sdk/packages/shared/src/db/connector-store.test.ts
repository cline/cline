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
			const record = store.get("telegram");
			expect(record?.type).toBe("telegram");
			expect(record?.values).toEqual({ "-k": "123:token" });
			expect(record?.security).toEqual({
				enabled: true,
				values: { userId: "42" },
			});
			expect(record?.connectArgs).toBeUndefined();
			expect(record?.enabled).toBe(true);
		});
	});

	it("preserves connection state when config is re-saved", () => {
		useTempDataDir();
		withStore((store) => {
			store.recordConnected("telegram", ["-k", "123:token"]);
			store.setEnabled("telegram", false);
			store.upsertConfig({
				channel: "telegram",
				values: { "-k": "456:rotated" },
			});
			const record = store.get("telegram");
			expect(record?.values).toEqual({ "-k": "456:rotated" });
			expect(record?.connectArgs).toEqual(["-k", "123:token"]);
			expect(record?.enabled).toBe(false);
		});
	});

	it("records connections and re-enables stopped connectors", () => {
		useTempDataDir();
		withStore((store) => {
			store.recordConnected("slack", [
				"--bot-token",
				"xoxb",
				"--app-token",
				"xapp",
			]);
			expect(store.get("slack")?.enabled).toBe(true);
			expect(store.get("slack")?.lastConnectedAt).toBeTruthy();

			store.setEnabled("slack", false);
			expect(store.get("slack")?.enabled).toBe(false);

			store.recordConnected("slack", ["--bot-token", "xoxb2"]);
			const record = store.get("slack");
			expect(record?.enabled).toBe(true);
			expect(record?.connectArgs).toEqual(["--bot-token", "xoxb2"]);
		});
	});

	it("disables all connectors and deletes individual entries", () => {
		useTempDataDir();
		withStore((store) => {
			store.recordConnected("slack", ["--bot-token", "xoxb"]);
			store.recordConnected("telegram", ["-k", "123:token"]);
			store.disableAll();
			expect(store.list().every((entry) => !entry.enabled)).toBe(true);

			expect(store.delete("slack")).toBe(true);
			expect(store.delete("slack")).toBe(false);
			expect(store.list().map((entry) => entry.channel)).toEqual(["telegram"]);
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
			const record = store.get("telegram");
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
			expect(store.get("telegram")?.values).toEqual({ "-k": "123:current" });
		});
	});
});
