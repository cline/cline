import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ComputerBackendRestart } from "./backend-restart";
import { ComputerUseClient } from "./client";

const fixturePath = fileURLToPath(
	new URL("./test-fixtures/fake-backend.mjs", import.meta.url),
);

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as net.AddressInfo;
			server.close(() => resolve(port));
		});
		server.on("error", reject);
	});
}

function shellQuote(value: string): string {
	return JSON.stringify(value);
}

/** The launch command shape a host would configure, quoted for the shell. */
function fixtureLaunchCommand(port: number): string {
	return `${shellQuote(process.execPath)} ${shellQuote(fixturePath)} ${port}`;
}

async function probePort(port: number, timeoutMs: number): Promise<boolean> {
	const client = new ComputerUseClient({
		port,
		connectTimeoutMs: timeoutMs,
		requestTimeoutMs: timeoutMs,
	});
	try {
		await client.getDisplayInfo();
		return true;
	} catch {
		return false;
	} finally {
		client.close();
	}
}

/** Spawns the fake backend directly (not via ComputerBackendRestart). */
async function startFakeBackend(port: number) {
	const child = spawn(process.execPath, [fixturePath, String(port)], {
		stdio: "ignore",
	});
	await (async function waitForReady(attempt = 0): Promise<void> {
		if (await probePort(port, 500)) {
			return;
		}
		if (attempt > 40) {
			throw new Error("fake backend never became ready");
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
		return waitForReady(attempt + 1);
	})();
	return child;
}

describe("ComputerBackendRestart", () => {
	it("reports already_running and does not spawn or adopt the backend", async () => {
		const port = await freePort();
		const child = await startFakeBackend(port);
		try {
			const restart = new ComputerBackendRestart({
				port,
				command: fixtureLaunchCommand(port),
				readyTimeoutMs: 15_000,
				pollIntervalMs: 200,
			});
			await expect(restart.ensureRunning()).resolves.toMatchObject({
				status: "already_running",
			});
			// Dispose must not kill a backend it did not spawn.
			await restart.dispose();
			expect(await probePort(port, 500)).toBe(true);
		} finally {
			child.kill();
		}
	});

	it("launches the configured command when the backend is down", async () => {
		const port = await freePort();
		const restart = new ComputerBackendRestart({
			port,
			command: fixtureLaunchCommand(port),
			readyTimeoutMs: 30_000,
			pollIntervalMs: 200,
		});
		await expect(restart.ensureRunning()).resolves.toMatchObject({
			status: "started",
		});
		// A real client connects to the restarted backend.
		expect(await probePort(port, 1_000)).toBe(true);
		// Dispose kills the backend this module spawned.
		await restart.dispose();
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(await probePort(port, 500)).toBe(false);
	});

	it("reports failed_to_start when the launch command exits immediately", async () => {
		const port = await freePort();
		const restart = new ComputerBackendRestart({
			port,
			command: `${shellQuote(process.execPath)} -e "process.exit(3)"`,
			readyTimeoutMs: 15_000,
			pollIntervalMs: 200,
		});
		const result = await restart.ensureRunning();
		expect(result.status).toBe("failed_to_start");
		if (result.status === "failed_to_start") {
			expect(result.error).toContain("exited with code 3");
		}
	});

	it("kills its own spawn and reports failure when the backend never answers", async () => {
		const port = await freePort();
		const restart = new ComputerBackendRestart({
			port,
			command: `${shellQuote(process.execPath)} -e "setInterval(() => {}, 60000)"`,
			readyTimeoutMs: 1_000,
			pollIntervalMs: 200,
		});
		const result = await restart.ensureRunning();
		expect(result).toMatchObject({
			status: "failed_to_start",
			error: expect.stringContaining("did not answer"),
		});
		await restart.dispose();
	});

	it("reports started for launch commands that daemonize and exit", async () => {
		const port = await freePort();
		const launcherPath = fileURLToPath(
			new URL("./test-fixtures/launcher-exits.mjs", import.meta.url),
		);
		const restart = new ComputerBackendRestart({
			port,
			// The launcher spawns the backend and exits immediately; the
			// backend it started must still be recognized as up.
			command: `${shellQuote(process.execPath)} ${shellQuote(launcherPath)} ${port} 15000`,
			readyTimeoutMs: 15_000,
			pollIntervalMs: 200,
		});
		await expect(restart.ensureRunning()).resolves.toMatchObject({
			status: "started",
		});
		expect(await probePort(port, 1_000)).toBe(true);
		// The backend was daemonized, so dispose has no owned child to kill —
		// and must not hunt for pids it never spawned. The fixture's lifetime
		// cleans up.
		await restart.dispose();
	});

	it("shares one run between concurrent ensureRunning calls", async () => {
		const port = await freePort();
		const restart = new ComputerBackendRestart({
			port,
			command: fixtureLaunchCommand(port),
			readyTimeoutMs: 30_000,
			pollIntervalMs: 200,
		});
		const results = await Promise.all([
			restart.ensureRunning(),
			restart.ensureRunning(),
		]);
		expect(results[0]).toEqual(results[1]);
		await restart.dispose();
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(await probePort(port, 500)).toBe(false);
	}, 30_000);
});
