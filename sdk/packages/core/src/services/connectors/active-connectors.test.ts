import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listActiveConnectors } from "./active-connectors";

describe("active connectors", () => {
	const originalDataDir = process.env.CLINE_DATA_DIR;
	const tempRoots: string[] = [];

	afterEach(() => {
		if (originalDataDir === undefined) {
			delete process.env.CLINE_DATA_DIR;
		} else {
			process.env.CLINE_DATA_DIR = originalDataDir;
		}
		for (const root of tempRoots.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns only live, valid connector state records", () => {
		const root = mkdtempSync(join(tmpdir(), "active-connectors-"));
		tempRoots.push(root);
		process.env.CLINE_DATA_DIR = root;
		const telegramDir = join(root, "connectors", "telegram");
		mkdirSync(telegramDir, { recursive: true });
		writeFileSync(
			join(telegramDir, "live.json"),
			JSON.stringify({
				pid: process.pid,
				hubUrl: "ws://127.0.0.1:25463/hub",
				botUsername: "cline_test_bot",
				startedAt: "2026-07-24T00:00:00.000Z",
			}),
		);
		writeFileSync(
			join(telegramDir, "dead.json"),
			JSON.stringify({
				pid: 2_147_483_647,
				hubUrl: "ws://127.0.0.1:25463/hub",
				botUsername: "dead_bot",
			}),
		);
		writeFileSync(
			join(telegramDir, "live.threads.json"),
			JSON.stringify({ pid: process.pid }),
		);

		expect(listActiveConnectors()).toEqual([
			{
				id: "telegram:cline_test_bot",
				type: "telegram",
				instanceId: "cline_test_bot",
				pid: process.pid,
				hubUrl: "ws://127.0.0.1:25463/hub",
				botUsername: "cline_test_bot",
				startedAt: "2026-07-24T00:00:00.000Z",
			},
		]);
	});
});
