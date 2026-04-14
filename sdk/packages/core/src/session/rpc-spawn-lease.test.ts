import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tryAcquireRpcSpawnLease } from "./rpc-spawn-lease";

describe("tryAcquireRpcSpawnLease", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		delete process.env.CLINE_DATA_DIR;
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("allows only one active lease per address", () => {
		const dataDir = mkdtempSync(path.join(os.tmpdir(), "rpc-spawn-lease-"));
		tempDirs.push(dataDir);
		process.env.CLINE_DATA_DIR = dataDir;

		const first = tryAcquireRpcSpawnLease("127.0.0.1:4317");
		const second = tryAcquireRpcSpawnLease("127.0.0.1:4317");

		expect(first).toBeDefined();
		expect(second).toBeUndefined();

		first?.release();

		const third = tryAcquireRpcSpawnLease("127.0.0.1:4317");
		expect(third).toBeDefined();
		third?.release();
	});

	it("lets different addresses acquire independent leases", () => {
		const dataDir = mkdtempSync(path.join(os.tmpdir(), "rpc-spawn-lease-"));
		tempDirs.push(dataDir);
		process.env.CLINE_DATA_DIR = dataDir;

		const first = tryAcquireRpcSpawnLease("127.0.0.1:4317");
		const second = tryAcquireRpcSpawnLease("127.0.0.1:4318");

		expect(first).toBeDefined();
		expect(second).toBeDefined();

		first?.release();
		second?.release();
	});

	it("reclaims a leftover lease owned by the current process", () => {
		const dataDir = mkdtempSync(path.join(os.tmpdir(), "rpc-spawn-lease-"));
		tempDirs.push(dataDir);
		process.env.CLINE_DATA_DIR = dataDir;

		const first = tryAcquireRpcSpawnLease("127.0.0.1:4317");
		expect(first).toBeDefined();
		const leasePath = first?.path;
		expect(leasePath).toBeTruthy();
		first?.release();

		writeFileSync(
			leasePath!,
			JSON.stringify({
				address: "127.0.0.1:4317",
				pid: process.pid,
				createdAt: Date.now(),
			}),
			"utf8",
		);

		const second = tryAcquireRpcSpawnLease("127.0.0.1:4317");
		assert(second);
		expect(
			JSON.parse(readFileSync(second.path, "utf8")) as { pid: number },
		).toMatchObject({
			pid: process.pid,
		});
		second.release();
	});
});
