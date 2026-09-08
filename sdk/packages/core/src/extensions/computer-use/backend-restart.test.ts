import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

async function startProbeServer() {
	let connections = 0;
	let respond = true;
	let onRequest: (() => void) | undefined;
	const sockets = new Set<net.Socket>();
	const server = net.createServer((socket) => {
		connections++;
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		socket.on("error", () => {});
		let buffer = "";
		socket.on("data", (data) => {
			buffer += data;
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				onRequest?.();
				onRequest = undefined;
				if (respond)
					socket.write(
						`${JSON.stringify({
							id: JSON.parse(line).id,
							ok: true,
							display: { widthPx: 100, heightPx: 100 },
						})}\n`,
					);
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		port: (server.address() as net.AddressInfo).port,
		get connections() {
			return connections;
		},
		set respond(value: boolean) {
			respond = value;
		},
		nextRequest: () =>
			new Promise<void>((resolve) => {
				onRequest = resolve;
			}),
		close: () =>
			new Promise<void>((resolve) => {
				for (const socket of sockets) socket.destroy();
				server.close(() => resolve());
			}),
	};
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
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
	it("reuses one shared connection and leaves it open on disposal", async () => {
		const server = await startProbeServer();
		const client = new ComputerUseClient({ port: server.port });
		const restart = new ComputerBackendRestart({
			client,
			port: server.port,
			command: "exit 9",
		});
		try {
			await client.getDisplayInfo();
			await expect(restart.ensureRunning()).resolves.toEqual({
				status: "already_running",
			});
			await expect(restart.ensureRunning()).resolves.toEqual({
				status: "already_running",
			});
			await restart.dispose();
			await client.getDisplayInfo();
			expect(server.connections).toBe(1);
		} finally {
			await restart.dispose();
			client.close();
			await server.close();
		}
	});

	it("does not launch or disconnect a busy backend after a queued probe times out", async () => {
		const server = await startProbeServer();
		const client = new ComputerUseClient({ port: server.port });
		const restart = new ComputerBackendRestart({
			client,
			port: server.port,
			command: "exit 9",
			probeTimeoutMs: 100,
		});
		try {
			await client.getDisplayInfo();
			server.respond = false;
			await expect(restart.ensureRunning()).resolves.toMatchObject({
				status: "failed_to_start",
				error: expect.stringContaining("refusing to launch a duplicate"),
			});
			server.respond = true;
			await client.getDisplayInfo();
			expect(server.connections).toBe(1);
		} finally {
			await restart.dispose();
			client.close();
			await server.close();
		}
	});

	it.each([
		"dispose",
		"cancel",
	])("%s during the initial probe prevents launch", async (action) => {
		const server = await startProbeServer();
		const controller = new AbortController();
		const directory = mkdtempSync(join(tmpdir(), "restart-probe-"));
		const marker = join(directory, "launched");
		const restart = new ComputerBackendRestart({
			port: server.port,
			probeTimeoutMs: 10_000,
			command: `${fixtureLaunchCommand(server.port)} 15000 0 ${shellQuote(marker)}`,
		});
		try {
			server.respond = false;
			const requested = server.nextRequest();
			const result = restart.ensureRunning(controller.signal);
			await requested;
			if (action === "dispose") await restart.dispose();
			else controller.abort();
			await expect(result).resolves.toMatchObject({
				status: "failed_to_start",
				error: expect.stringContaining(
					action === "dispose" ? "disposed" : "cancelled",
				),
			});
			await restart.dispose();
			await expect(restart.ensureRunning()).resolves.toMatchObject({
				status: "failed_to_start",
				error: expect.stringContaining("disposed"),
			});
			expect(existsSync(marker)).toBe(false);
		} finally {
			await restart.dispose();
			await server.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("does not probe or launch for an already-cancelled request", async () => {
		const server = await startProbeServer();
		const restart = new ComputerBackendRestart({
			port: server.port,
			command: "exit 9",
		});
		try {
			await expect(
				restart.ensureRunning(AbortSignal.abort()),
			).resolves.toMatchObject({ status: "failed_to_start" });
			expect(server.connections).toBe(0);
		} finally {
			await restart.dispose();
			await server.close();
		}
	});

	it.each([
		"timeout",
		"cancel",
		"dispose",
	])("%s waits for owned process-tree cleanup", async (action) => {
		const port = await freePort();
		const directory = mkdtempSync(join(tmpdir(), "restart-child-"));
		const marker = join(directory, "pid");
		const controller = new AbortController();
		const command = `${fixtureLaunchCommand(port)} 15000 0 ${shellQuote(marker)} silent`;
		const restart = new ComputerBackendRestart({
			port,
			// Keep the Unix shell alive to exercise group, not just child, termination.
			command: process.platform === "win32" ? command : `${command} & wait`,
			probeTimeoutMs: 100,
			readyTimeoutMs: action === "timeout" ? 1500 : 10_000,
			pollIntervalMs: 50,
		});
		let pid: number | undefined;
		try {
			const result = restart.ensureRunning(controller.signal);
			await expect.poll(() => existsSync(marker), { timeout: 5000 }).toBe(true);
			const childPid = Number(readFileSync(marker, "utf8"));
			pid = childPid;
			expect(isAlive(pid)).toBe(true);
			if (action === "cancel") controller.abort();
			if (action === "dispose") await restart.dispose();
			await expect(result).resolves.toMatchObject({
				status: "failed_to_start",
				error: expect.stringContaining(
					action === "timeout"
						? "did not answer"
						: action === "cancel"
							? "cancelled"
							: "disposed",
				),
			});
			await expect.poll(() => isAlive(childPid), { timeout: 2000 }).toBe(false);
			expect(await probePort(port, 100)).toBe(false);
		} finally {
			await restart.dispose();
			if (pid && isAlive(pid)) process.kill(pid, "SIGKILL");
			rmSync(directory, { recursive: true, force: true });
		}
	});

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
		const startedAt = Date.now();
		const result = await restart.ensureRunning();
		expect(Date.now() - startedAt).toBeLessThan(10_000);
		expect(result.status).toBe("failed_to_start");
		if (result.status === "failed_to_start") {
			expect(result.error).toContain("exited with code 3");
		}
		await restart.dispose();
	});

	it.skipIf(process.platform !== "win32")(
		"reports shell spawn error events as a typed failure",
		async () => {
			const port = await freePort();
			const directory = mkdtempSync(join(tmpdir(), "restart-shell-"));
			const comSpec = process.env.ComSpec;
			const restart = new ComputerBackendRestart({
				port,
				command: "exit 0",
				readyTimeoutMs: 10_000,
			});
			try {
				process.env.ComSpec = join(directory, "missing-shell.exe");
				await expect(restart.ensureRunning()).resolves.toMatchObject({
					status: "failed_to_start",
					error: expect.stringContaining("ENOENT"),
				});
			} finally {
				if (comSpec === undefined) delete process.env.ComSpec;
				else process.env.ComSpec = comSpec;
				await restart.dispose();
				rmSync(directory, { recursive: true, force: true });
			}
		},
	);

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
			command: `${shellQuote(process.execPath)} ${shellQuote(launcherPath)} ${port} 15000 1500`,
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
		expect(await probePort(port, 1_000)).toBe(true);
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
