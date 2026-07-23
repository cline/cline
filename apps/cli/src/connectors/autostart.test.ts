import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteConnectorStore } from "@cline/shared/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	disableConnectorAutostart,
	persistConnectorConnection,
	reconnectPersistedConnectors,
} from "./autostart";

describe("connector autostart", () => {
	const previousDataDir = process.env.CLINE_DATA_DIR;
	const tempRoots: string[] = [];

	afterEach(() => {
		if (previousDataDir === undefined) {
			delete process.env.CLINE_DATA_DIR;
		} else {
			process.env.CLINE_DATA_DIR = previousDataDir;
		}
		for (const root of tempRoots.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	function useTempDataDir(): string {
		const root = mkdtempSync(join(tmpdir(), "connector-autostart-"));
		tempRoots.push(root);
		process.env.CLINE_DATA_DIR = root;
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

	it("persists connect args without the interactive flag", () => {
		useTempDataDir();
		persistConnectorConnection("telegram", [
			"-k",
			"123:token",
			"-i",
			"--allow-user",
			"42",
		]);
		const record = withStore((store) => store.get("telegram"));
		expect(record?.connectArgs).toEqual([
			"-k",
			"123:token",
			"--allow-user",
			"42",
		]);
		expect(record?.enabled).toBe(true);
	});

	it("reconnects enabled connectors that have stored connect args", async () => {
		useTempDataDir();
		persistConnectorConnection("telegram", ["-k", "123:token"]);
		persistConnectorConnection("slack", ["--bot-token", "xoxb"]);
		disableConnectorAutostart("slack");
		withStore((store) =>
			store.upsertConfig({ channel: "linear", values: { "-k": "lin" } }),
		);

		const start = vi.fn().mockResolvedValue(true);
		const attempts = await reconnectPersistedConnectors({ start });

		expect(start).toHaveBeenCalledTimes(1);
		expect(start).toHaveBeenCalledWith("telegram", ["-k", "123:token"]);
		expect(attempts).toEqual([{ channel: "telegram", ok: true }]);
	});

	it("skips connectors that are already running", async () => {
		const root = useTempDataDir();
		persistConnectorConnection("telegram", ["-k", "123:token"]);

		const stateDir = join(root, "connectors", "telegram");
		mkdirSync(stateDir, { recursive: true });
		writeFileSync(
			join(stateDir, "bot.json"),
			JSON.stringify({
				pid: process.pid,
				hubUrl: "ws://127.0.0.1:7777",
				botUsername: "test_bot",
				startedAt: "2026-07-07T00:00:00.000Z",
			}),
			"utf8",
		);

		const start = vi.fn().mockResolvedValue(true);
		const attempts = await reconnectPersistedConnectors({ start });

		expect(start).not.toHaveBeenCalled();
		expect(attempts).toEqual([]);
	});

	it("reports failed reconnect attempts", async () => {
		useTempDataDir();
		persistConnectorConnection("telegram", ["-k", "123:token"]);

		const start = vi.fn().mockRejectedValue(new Error("boom"));
		const attempts = await reconnectPersistedConnectors({ start });

		expect(attempts).toEqual([
			{ channel: "telegram", ok: false, error: "boom" },
		]);
	});

	it("disables all connectors when no channel is given", async () => {
		useTempDataDir();
		persistConnectorConnection("telegram", ["-k", "123:token"]);
		persistConnectorConnection("slack", ["--bot-token", "xoxb"]);
		disableConnectorAutostart();

		const start = vi.fn().mockResolvedValue(true);
		expect(await reconnectPersistedConnectors({ start })).toEqual([]);
		expect(start).not.toHaveBeenCalled();
	});
});
