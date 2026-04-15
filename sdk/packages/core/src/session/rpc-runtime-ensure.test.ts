import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockGetRpcServerHealth } = vi.hoisted(() => ({
	mockGetRpcServerHealth: vi.fn(),
}));

vi.mock("@clinebot/rpc", () => ({
	getRpcServerHealth: mockGetRpcServerHealth,
	requestRpcServerShutdown: vi.fn(),
	RPC_BUILD_VERSION: "rpc-build-test",
	RPC_PROTOCOL_VERSION: "rpc-protocol-test",
	RpcSessionClient: class {},
}));

import { withRpcStartupLock } from "./rpc-runtime-ensure";

describe("withRpcStartupLock", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		delete process.env.CLINE_DATA_DIR;
		vi.clearAllMocks();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("records running status after startup completes", async () => {
		const dataDir = mkdtempSync(
			path.join(os.tmpdir(), "rpc-runtime-ensure-status-"),
		);
		tempDirs.push(dataDir);
		process.env.CLINE_DATA_DIR = dataDir;

		const address = "127.0.0.1:4317";
		const lockDir = path.join(
			dataDir,
			"locks",
			"rpc-start-127.0.0.1_4317.lock",
		);
		const ownerPath = path.join(lockDir, "owner.json");

		await withRpcStartupLock(address, async (lock) => {
			const starting = JSON.parse(readFileSync(ownerPath, "utf8")) as {
				status: string;
			};
			expect(starting.status).toBe("starting");

			await lock.markRunning({
				resolvedAddress: "127.0.0.1:4318",
				serverId: "server-1",
			});

			const running = JSON.parse(readFileSync(ownerPath, "utf8")) as {
				status: string;
				resolvedAddress?: string;
				serverId?: string;
			};
			expect(running).toMatchObject({
				status: "running",
				resolvedAddress: "127.0.0.1:4318",
				serverId: "server-1",
			});
		});

		expect(existsSync(lockDir)).toBe(false);
	});

	it("reclaims a running lock when its recorded server is unreachable", async () => {
		const dataDir = mkdtempSync(
			path.join(os.tmpdir(), "rpc-runtime-ensure-stale-"),
		);
		tempDirs.push(dataDir);
		process.env.CLINE_DATA_DIR = dataDir;

		const address = "127.0.0.1:4317";
		const lockDir = path.join(
			dataDir,
			"locks",
			"rpc-start-127.0.0.1_4317.lock",
		);
		const ownerPath = path.join(lockDir, "owner.json");
		mkdirSync(lockDir, { recursive: true });
		writeFileSync(
			ownerPath,
			JSON.stringify(
				{
					pid: process.pid,
					address,
					acquiredAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					status: "running",
					resolvedAddress: address,
					serverId: "server-stale",
				},
				null,
				2,
			),
			"utf8",
		);

		mockGetRpcServerHealth.mockResolvedValue(undefined);

		let acquired = 0;
		await withRpcStartupLock(address, async () => {
			acquired += 1;
		});

		expect(acquired).toBe(1);
		expect(mockGetRpcServerHealth).toHaveBeenCalledWith(address);
		expect(existsSync(lockDir)).toBe(false);
	});
});
