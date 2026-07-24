import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteConnectorStore } from "@cline/shared/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	disableConnectorAutostart,
	persistConnectorConnection,
	reconnectPersistedConnectors,
} from "./connector-autostart";

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

	function useTempDataDir(): void {
		const root = mkdtempSync(join(tmpdir(), "connector-autostart-"));
		tempRoots.push(root);
		process.env.CLINE_DATA_DIR = root;
	}

	function withStore<T>(fn: (store: SqliteConnectorStore) => T): T {
		const store = new SqliteConnectorStore();
		try {
			return fn(store);
		} finally {
			store.close();
		}
	}

	it("persists connect args without interactive flags", () => {
		useTempDataDir();
		persistConnectorConnection("telegram", [
			"-k",
			"123:token",
			"-i",
			"--allow-user",
			"42",
			"--interactive",
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

	it("reconnects only enabled connectors with stored connect args", async () => {
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

	it("reconnects env-only connectors that persisted empty connect args", async () => {
		useTempDataDir();
		persistConnectorConnection("telegram", []);

		const start = vi.fn().mockResolvedValue(true);
		const attempts = await reconnectPersistedConnectors({ start });

		expect(start).toHaveBeenCalledTimes(1);
		expect(start).toHaveBeenCalledWith("telegram", []);
		expect(attempts).toEqual([{ channel: "telegram", ok: true }]);
	});

	it("lets the host skip connectors that are already active", async () => {
		useTempDataDir();
		persistConnectorConnection("telegram", ["-k", "123:token"]);

		const start = vi.fn().mockResolvedValue(true);
		const attempts = await reconnectPersistedConnectors({
			start,
			isActive: (channel) => channel === "telegram",
		});

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
