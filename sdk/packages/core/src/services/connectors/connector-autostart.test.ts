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
		persistConnectorConnection(
			"telegram",
			"cline_bot",
			["-k", "123:token", "-i", "--allow-user", "42", "--interactive"],
			"/workspace",
		);

		const record = withStore((store) =>
			store.getConnection("telegram", "cline_bot"),
		);
		expect(record?.connectArgs).toEqual([
			"-k",
			"123:token",
			"--allow-user",
			"42",
			"--cwd",
			"/workspace",
		]);
		expect(record?.enabled).toBe(true);
	});

	it("reconnects only enabled connectors with stored connect args", async () => {
		useTempDataDir();
		persistConnectorConnection(
			"telegram",
			"cline_bot",
			["-k", "123:token"],
			"/telegram-workspace",
		);
		persistConnectorConnection(
			"slack",
			"workspace",
			["--bot-token", "xoxb"],
			"/slack-workspace",
		);
		disableConnectorAutostart("slack");
		withStore((store) =>
			store.upsertConfig({ channel: "linear", values: { "-k": "lin" } }),
		);

		const start = vi.fn().mockResolvedValue(true);
		const attempts = await reconnectPersistedConnectors({ start });

		expect(start).toHaveBeenCalledTimes(1);
		expect(start).toHaveBeenCalledWith({
			channel: "telegram",
			instanceId: "cline_bot",
			args: ["-k", "123:token", "--cwd", "/telegram-workspace"],
		});
		expect(attempts).toEqual([
			{ channel: "telegram", instanceId: "cline_bot", ok: true },
		]);
	});

	it("persists the originating workspace for env-only connectors", async () => {
		useTempDataDir();
		persistConnectorConnection("telegram", "cline_bot", [], "/workspace");

		const start = vi.fn().mockResolvedValue(true);
		const attempts = await reconnectPersistedConnectors({ start });

		expect(start).toHaveBeenCalledTimes(1);
		expect(start).toHaveBeenCalledWith({
			channel: "telegram",
			instanceId: "cline_bot",
			args: ["--cwd", "/workspace"],
		});
		expect(attempts).toEqual([
			{ channel: "telegram", instanceId: "cline_bot", ok: true },
		]);
	});

	it("lets the host skip connectors that are known to be healthy", async () => {
		useTempDataDir();
		persistConnectorConnection("telegram", "cline_bot", ["-k", "123:token"]);

		const start = vi.fn().mockResolvedValue(true);
		const attempts = await reconnectPersistedConnectors({
			start,
			isHealthy: ({ channel, instanceId }) =>
				channel === "telegram" && instanceId === "cline_bot",
		});

		expect(start).not.toHaveBeenCalled();
		expect(attempts).toEqual([]);
	});

	it("preserves an explicitly configured workspace", () => {
		useTempDataDir();
		persistConnectorConnection(
			"telegram",
			"cline_bot",
			["-k", "123:token", "--cwd=/explicit"],
			"/ignored",
		);

		expect(
			withStore(
				(store) => store.getConnection("telegram", "cline_bot")?.connectArgs,
			),
		).toEqual(["-k", "123:token", "--cwd=/explicit"]);
	});

	it("reports failed reconnect attempts", async () => {
		useTempDataDir();
		persistConnectorConnection("telegram", "cline_bot", ["-k", "123:token"]);

		const start = vi.fn().mockRejectedValue(new Error("boom"));
		const attempts = await reconnectPersistedConnectors({ start });

		expect(attempts).toEqual([
			{
				channel: "telegram",
				instanceId: "cline_bot",
				ok: false,
				error: "boom",
			},
		]);
	});

	it("reconnects every persisted instance in the same channel", async () => {
		useTempDataDir();
		persistConnectorConnection("telegram", "first_bot", ["-k", "first:token"]);
		persistConnectorConnection("telegram", "second_bot", [
			"-k",
			"second:token",
		]);

		const start = vi.fn().mockResolvedValue(true);
		const attempts = await reconnectPersistedConnectors({ start });

		expect(start).toHaveBeenCalledTimes(2);
		expect(attempts).toEqual([
			{ channel: "telegram", instanceId: "first_bot", ok: true },
			{ channel: "telegram", instanceId: "second_bot", ok: true },
		]);
	});

	it("disables all connectors when no channel is given", async () => {
		useTempDataDir();
		persistConnectorConnection("telegram", "cline_bot", ["-k", "123:token"]);
		persistConnectorConnection("slack", "workspace", ["--bot-token", "xoxb"]);
		disableConnectorAutostart();

		const start = vi.fn().mockResolvedValue(true);
		expect(await reconnectPersistedConnectors({ start })).toEqual([]);
		expect(start).not.toHaveBeenCalled();
	});
});
