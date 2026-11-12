import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FactoryAppEnvironment } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	FactoryAppEnvironmentError,
	type FactoryAppEnvironmentHandle,
	type FactoryAppEnvironmentRecord,
	factoryAppPortInUse,
	findFactoryAppProcesses,
	parseNetstatListeningPids,
	planWindowsFactoryAppKill,
	startFactoryAppEnvironment,
	stopFactoryAppEnvironment,
} from "./factory-app-environment";

const APP = `const fs = require("node:fs");
const net = require("node:net");
const mode = process.argv[2];
const port = Number(process.env.FACTORY_APP_PORT);
const serve = (host) =>
	require("node:http")
		.createServer((_, response) => response.end("app ok"))
		.listen(port, host);
if (mode === "serve") {
	fs.writeFileSync(
		"seen.json",
		JSON.stringify({
			port: process.env.FACTORY_APP_PORT,
			url: process.env.FACTORY_APP_URL,
			named: process.env.APP_PORT,
			token: process.env.FACTORY_APP_TOKEN,
		}),
	);
	setTimeout(() => serve("127.0.0.1"), Number(process.argv[3] ?? 0));
} else if (mode === "serve6") {
	serve("::1");
} else if (mode === "daemon") {
	require("node:child_process")
		.spawn(process.execPath, [__filename, "serve"], {
			detached: true,
			stdio: "ignore",
		})
		.unref();
} else if (mode === "health") {
	net
		.connect(port, "127.0.0.1")
		.on("connect", () => process.exit(0))
		.on("error", () => process.exit(1));
} else if (mode === "tick") {
	setInterval(() => fs.appendFileSync("ticks.txt", "."), 20);
}
`;

let cwd: string;
let storageDir: string;
const started: FactoryAppEnvironmentHandle[] = [];
const strays: Array<() => void> = [];
const node = (...args: string[]) =>
	[process.execPath, path.join(cwd, "app.cjs"), ...args]
		.map((part) => JSON.stringify(part))
		.join(" ");
const start = (
	environment: FactoryAppEnvironment,
	options: Partial<Parameters<typeof startFactoryAppEnvironment>[0]> = {},
) =>
	startFactoryAppEnvironment({
		environment,
		cwd,
		storageDir,
		runId: "run_1",
		signal: new AbortController().signal,
		pollMs: 50,
		...options,
	}).then((handle) => {
		started.push(handle);
		return handle;
	});
const idle = (env: Record<string, string> = {}) => {
	const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
		detached: true,
		stdio: "ignore",
		env: { ...process.env, ...env },
	});
	const exited = new Promise((resolve) =>
		child.once("exit", (_code, signal) => resolve(signal)),
	);
	strays.push(() => child.kill("SIGKILL"));
	if (!child.pid) throw new Error("Test process did not start");
	return {
		pid: child.pid,
		exited,
		alive: () => child.exitCode === null && child.signalCode === null,
	};
};
const lastRecord = (record: ReturnType<typeof vi.fn>) =>
	record.mock.calls.at(-1)?.[0] as FactoryAppEnvironmentRecord;

beforeEach(async () => {
	cwd = await mkdtemp(path.join(tmpdir(), "factory-app-environment-"));
	storageDir = path.join(cwd, "storage");
	await writeFile(path.join(cwd, "app.cjs"), APP);
});
afterEach(async () => {
	for (const handle of started.splice(0)) await handle.stop();
	for (const kill of strays.splice(0)) kill();
	await rm(cwd, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("Factory app environment", () => {
	it("runs setup, starts the app on a free port and waits for the healthcheck", async () => {
		const record = vi.fn();
		const app = await start(
			{
				setup: 'echo "setup on $FACTORY_APP_PORT at $FACTORY_APP_URL"',
				start: node("serve", "300"),
				healthcheck: node("health"),
				portEnv: "APP_PORT",
			},
			{ record },
		);
		expect(app.url).toBe(`http://localhost:${app.port}`);
		expect(await (await fetch(`http://127.0.0.1:${app.port}`)).text()).toBe(
			"app ok",
		);
		const seen = JSON.parse(
			await readFile(path.join(cwd, "seen.json"), "utf8"),
		);
		expect(seen).toEqual({
			port: String(app.port),
			url: app.url,
			named: String(app.port),
			token: expect.stringMatching(/^[0-9a-f-]{36}$/),
		});
		// The identity grows as each process starts, all under one token.
		expect(record.mock.calls.map(([entry]) => entry)).toEqual([
			{ port: app.port, token: seen.token },
			{ port: app.port, token: seen.token, setupPid: expect.any(Number) },
			{
				port: app.port,
				token: seen.token,
				setupPid: expect.any(Number),
				pid: app.pid,
			},
		]);
		expect(
			app.logPath.startsWith(path.join(storageDir, "factory-app-logs")),
		).toBe(true);
		expect(await readFile(app.logPath, "utf8")).toContain(
			`setup on ${app.port} at ${app.url}`,
		);
		await app.stop();
		expect(await factoryAppPortInUse(app.port)).toBe(false);
	});

	it("exports PORT by default", async () => {
		const app = await start({ setup: 'echo "$PORT" > port.txt' });
		expect(await readFile(path.join(cwd, "port.txt"), "utf8")).toBe(
			`${app.port}\n`,
		);
	});

	it("gives environments started together different ports", async () => {
		const apps = await Promise.all(
			Array.from({ length: 4 }, () => start({ setup: "true" })),
		);
		expect(new Set(apps.map((app) => app.port)).size).toBe(4);
	});

	it("fails setup with its output and never spawns the app", async () => {
		const record = vi.fn();
		const failure = await start(
			{ setup: "echo dependency missing; exit 7", start: node("serve") },
			{ record },
		).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(FactoryAppEnvironmentError);
		expect(failure).toMatchObject({ stage: "setup" });
		expect(String((failure as Error).message)).toMatch(
			/^Verifier app environment failed \(setup\): exited with code 7\.\ndependency missing/,
		);
		expect(existsSync(path.join(cwd, "seen.json"))).toBe(false);
		expect(lastRecord(record).pid).toBeUndefined();
	});

	it("refuses a port that something else took during setup", async () => {
		const squatter = createServer();
		const record = vi.fn((entry: FactoryAppEnvironmentRecord) => {
			if (!squatter.listening && !entry.setupPid)
				squatter.listen(entry.port, "127.0.0.1");
		});
		try {
			const failure = await start(
				{ setup: "sleep 0.3", start: node("serve") },
				{ record },
			).catch((error: unknown) => error);
			expect(failure).toMatchObject({ stage: "start" });
			expect((failure as Error).message).toContain(
				"already accepted connections before the app started",
			);
			expect(existsSync(path.join(cwd, "seen.json"))).toBe(false);
		} finally {
			await new Promise((resolve) => squatter.close(resolve));
		}
	});

	it("fails as soon as the start command exits, with the log tail", async () => {
		const begun = Date.now();
		const failure = await start({
			start: "echo crashed on boot >&2; exit 3",
			readyTimeoutSeconds: 60,
		}).catch((error: unknown) => error);
		expect(failure).toMatchObject({ stage: "start" });
		expect((failure as Error).message).toContain(
			"start command exited with code 3 before the app was ready",
		);
		expect((failure as Error).message).toContain("crashed on boot");
		expect(Date.now() - begun).toBeLessThan(10_000);
	});

	it("requires a start command without a healthcheck to keep running", async () => {
		const failure = await start({
			start: "exit 0",
			readyTimeoutSeconds: 60,
		}).catch((error: unknown) => error);
		expect(failure).toMatchObject({ stage: "start" });
		expect((failure as Error).message).toContain(
			"without a healthcheck it must keep running",
		);
	});

	it("accepts a start command that daemonizes once its healthcheck passes, and still stops the daemon", async () => {
		const app = await start({
			start: node("daemon"),
			healthcheck: node("health"),
		});
		expect(await factoryAppPortInUse(app.port)).toBe(true);
		await app.stop();
		await vi.waitFor(async () =>
			expect(await factoryAppPortInUse(app.port)).toBe(false),
		);
	});

	it("gives up after the ready timeout and kills the app", async () => {
		const record = vi.fn();
		const failure = await start(
			{
				start: node("serve"),
				healthcheck: "echo still warming; exit 1",
				readyTimeoutSeconds: 1,
				cleanup: 'echo "$FACTORY_APP_PORT" >> cleanup.txt',
			},
			{ record },
		).catch((error: unknown) => error);
		expect(failure).toMatchObject({ stage: "healthcheck" });
		expect((failure as Error).message).toContain(
			"healthcheck did not pass within 1 seconds",
		);
		expect((failure as Error).message).toContain("still warming");
		const { port } = lastRecord(record);
		expect(await factoryAppPortInUse(port)).toBe(false);
		expect(await readFile(path.join(cwd, "cleanup.txt"), "utf8")).toBe(
			`${port}\n`,
		);
	});

	it("probes the allocated port when no healthcheck is configured", async () => {
		const app = await start({ start: node("serve", "300") });
		expect(await factoryAppPortInUse(app.port)).toBe(true);
	});

	it("treats an app listening only on IPv6 loopback as ready", async () => {
		const probe = createServer();
		const ipv6 = await new Promise<boolean>((resolve) => {
			probe.once("error", () => resolve(false));
			probe.listen(0, "::1", () => probe.close(() => resolve(true)));
		});
		if (!ipv6) return; // No IPv6 loopback on this host.
		const app = await start({ start: node("serve6") });
		expect(await factoryAppPortInUse(app.port)).toBe(true);
	});

	it("reports a probe timeout when nothing listens on the port", async () => {
		const failure = await start({
			start: "sleep 30",
			readyTimeoutSeconds: 1,
		}).catch((error: unknown) => error);
		expect(failure).toMatchObject({ stage: "healthcheck" });
		expect((failure as Error).message).toContain(
			"nothing accepted connections on port",
		);
	});

	it("stops the whole process tree, runs cleanup once and ignores a failing cleanup", async () => {
		const app = await start({
			start: `${node("tick")} & ${node("serve")}`,
			cleanup: 'echo "$FACTORY_APP_PORT" >> cleanup.txt',
		});
		const ticks = path.join(cwd, "ticks.txt");
		await vi.waitFor(async () =>
			expect((await stat(ticks)).size).toBeGreaterThan(0),
		);
		await Promise.all([app.stop(), app.stop()]);
		await app.stop();
		const size = (await stat(ticks)).size;
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect((await stat(ticks)).size).toBe(size);
		expect(await factoryAppPortInUse(app.port)).toBe(false);
		expect(await readFile(path.join(cwd, "cleanup.txt"), "utf8")).toBe(
			`${app.port}\n`,
		);

		const failing = await start({
			start: node("serve"),
			cleanup: "exit 9",
		});
		await expect(failing.stop()).resolves.toBeUndefined();
	});

	it("stops the app and rejects when aborted while waiting", async () => {
		const abort = new AbortController();
		const record = vi.fn();
		const pending = start(
			{
				start: node("serve"),
				healthcheck: "exit 1",
				cleanup: "touch cleaned.txt",
			},
			{ signal: abort.signal, record },
		);
		await vi.waitFor(() => expect(lastRecord(record)?.pid).toBeDefined());
		abort.abort(new Error("Feature cancelled"));
		await expect(pending).rejects.toThrow("Feature cancelled");
		expect(existsSync(path.join(cwd, "cleaned.txt"))).toBe(true);
		expect(await factoryAppPortInUse(lastRecord(record).port)).toBe(false);
	});

	it("runs a setup-only environment without a process or port wait", async () => {
		const record = vi.fn();
		const app = await start(
			{ setup: "echo prepared", readyTimeoutSeconds: 900 },
			{ record },
		);
		expect(app.pid).toBeUndefined();
		expect(lastRecord(record)).toEqual({
			port: app.port,
			token: expect.any(String),
			setupPid: expect.any(Number),
		});
		expect(await readFile(app.logPath, "utf8")).toContain("prepared");
	});

	it.skipIf(process.platform !== "linux")(
		"stops a recorded leftover only through processes that carry its token",
		async () => {
			const token = "leftover-token";
			const leftover = idle({ FACTORY_APP_TOKEN: token });
			const daemon = idle({ FACTORY_APP_TOKEN: token });
			// Its pid was "reused" by a process that does not carry the token.
			const unrelated = idle();
			expect((await findFactoryAppProcesses(token)).sort()).toEqual(
				[leftover.pid, daemon.pid].sort(),
			);
			await stopFactoryAppEnvironment({
				environment: {
					start: node("serve"),
					cleanup: 'echo "$FACTORY_APP_URL $FACTORY_APP_TOKEN" > cleanup.txt',
				},
				cwd,
				record: {
					port: 45_678,
					token,
					pid: leftover.pid,
					setupPid: unrelated.pid,
				},
			});
			await expect(leftover.exited).resolves.toBe("SIGKILL");
			await expect(daemon.exited).resolves.toBe("SIGKILL");
			expect(unrelated.alive()).toBe(true);
			expect(await readFile(path.join(cwd, "cleanup.txt"), "utf8")).toBe(
				`http://localhost:45678 ${token}\n`,
			);
		},
	);

	it("never kills a leftover recorded without a token", async () => {
		const legacy = idle();
		await stopFactoryAppEnvironment({
			environment: { start: node("serve"), cleanup: "touch cleaned.txt" },
			cwd,
			record: { port: 45_678, pid: legacy.pid },
		});
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(legacy.alive()).toBe(true);
		expect(existsSync(path.join(cwd, "cleaned.txt"))).toBe(true);
	});
});

describe("Windows leftover kill decision", () => {
	const NETSTAT = [
		"",
		"Active Connections",
		"",
		"  Proto  Local Address          Foreign Address        State           PID",
		"  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1012",
		"  TCP    127.0.0.1:45678        0.0.0.0:0              LISTENING       4242",
		"  TCP    127.0.0.1:45678        127.0.0.1:50000        ESTABLISHED     7777",
		"  TCP    [::1]:45678            [::]:0                 ABHÖREN         4243",
		"  TCP    127.0.0.1:456789       0.0.0.0:0              LISTENING       9999",
		"  UDP    0.0.0.0:45678          *:*                                    5555",
	].join("\r\n");

	it("parses the listening owners of a port from IPv4 and IPv6 rows", () => {
		expect(parseNetstatListeningPids(NETSTAT, 45_678).sort()).toEqual([
			4242, 4243,
		]);
		expect(parseNetstatListeningPids(NETSTAT, 3000)).toEqual([]);
	});

	const record = { port: 45_678, token: "t", pid: 4242, setupPid: 3131 };

	it("kills a recorded pid only when it owns the listening port", async () => {
		const query = vi.fn(async () => [4242]);
		await expect(planWindowsFactoryAppKill(record, query)).resolves.toEqual({
			kill: [4242],
			skipped: [
				{
					pid: 3131,
					reason: "port 45678 is owned by pid 4242, not this pid",
				},
			],
		});
		expect(query).toHaveBeenCalledWith(45_678);
	});

	it("skips a possibly reused pid when another process owns the port", async () => {
		await expect(
			planWindowsFactoryAppKill(record, async () => [8080]),
		).resolves.toEqual({
			kill: [],
			skipped: [
				{ pid: 4242, reason: "port 45678 is owned by pid 8080, not this pid" },
				{ pid: 3131, reason: "port 45678 is owned by pid 8080, not this pid" },
			],
		});
	});

	it("kills the setup pid when it is the port owner", async () => {
		await expect(
			planWindowsFactoryAppKill(record, async () => [3131]),
		).resolves.toMatchObject({ kill: [3131] });
	});

	it("skips every pid when the port owner cannot be determined", async () => {
		for (const query of [
			async () => undefined,
			async () => {
				throw new Error("netstat missing");
			},
		])
			await expect(planWindowsFactoryAppKill(record, query)).resolves.toEqual({
				kill: [],
				skipped: [
					{ pid: 4242, reason: "could not determine the owner of port 45678" },
					{ pid: 3131, reason: "could not determine the owner of port 45678" },
				],
			});
	});

	it("plans nothing when nothing listens on the port", async () => {
		await expect(
			planWindowsFactoryAppKill(record, async () => []),
		).resolves.toEqual({ kill: [], skipped: [] });
	});

	it("never kills a record without a token and does not query", async () => {
		const query = vi.fn(async () => [4242]);
		await expect(
			planWindowsFactoryAppKill({ port: 45_678, pid: 4242 }, query),
		).resolves.toEqual({
			kill: [],
			skipped: [
				{ pid: 4242, reason: "record has no token (predates identity checks)" },
			],
		});
		expect(query).not.toHaveBeenCalled();
	});
});
