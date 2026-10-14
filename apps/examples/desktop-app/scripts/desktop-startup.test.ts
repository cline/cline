import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	closeSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHubBuildIdentity } from "@cline/core/hub";
import { CURRENT_HUB_PROTOCOL_VERSION } from "@cline/shared";
import { compileCliBinary } from "../../../cli/script/compile-binary";

// Exercise the shipped runtime artifacts: the compiled Cline CLI that starts
// the Hub and the backend bundle that runs on its embedded runtime. Source-only
// tests miss mixed SDK build identities between the desktop client and the
// CLI-managed Hub it attaches to.

let buildDir: string | undefined;

function ensureBuildDir(): string {
	buildDir ??= mkdtempSync(join(tmpdir(), "cline-desktop-startup-bin-"));
	return buildDir;
}

let compiledCli: string | undefined;
async function resolveCliBinary(): Promise<string> {
	if (process.env.CLINE_TEST_DESKTOP_CLI_BIN) {
		return resolve(process.env.CLINE_TEST_DESKTOP_CLI_BIN);
	}
	if (!compiledCli) {
		const outfile = join(
			ensureBuildDir(),
			process.platform === "win32" ? "cline-cli.exe" : "cline-cli",
		);
		await compileCliBinary({
			bunTarget:
				`bun-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}` as Bun.Build.CompileTarget,
			outfile,
			autoloadLaunchDirectoryConfig: false,
			execArgv: ["--use-system-ca"],
		});
		compiledCli = outfile;
	}
	return compiledCli;
}

let bundledBackend: string | undefined;
function resolveBackendBundle(): string {
	if (process.env.CLINE_TEST_DESKTOP_BACKEND_BUNDLE) {
		return resolve(process.env.CLINE_TEST_DESKTOP_BACKEND_BUNDLE);
	}
	if (!bundledBackend) {
		const outdir = join(ensureBuildDir(), "desktop-backend");
		const build = spawnSync(
			process.execPath,
			[
				"build",
				fileURLToPath(new URL("../sidecar/index.ts", import.meta.url)),
				"--target",
				"bun",
				"--outdir",
				outdir,
			],
			{ encoding: "utf8", timeout: 120_000 },
		);
		expect(build.status, build.stderr || String(build.error)).toBe(0);
		bundledBackend = join(outdir, "index.js");
	}
	return bundledBackend;
}

afterAll(() => {
	if (buildDir) {
		try {
			rmSync(buildDir, {
				recursive: true,
				force: true,
				maxRetries: 20,
				retryDelay: 100,
			});
		} catch {
			/* The runner discards its temp directory anyway. */
		}
	}
});

test("the shipped CLI and backend report telemetry without starting a hub", async () => {
	const cli = await resolveCliBinary();
	const bundle = resolveBackendBundle();
	for (const args of [
		["--telemetry-selfcheck"],
		["run", "--no-env-file", bundle, "--telemetry-selfcheck"],
	]) {
		const result = spawnSync(cli, args, {
			encoding: "utf8",
			timeout: 10_000,
			env: { ...process.env, BUN_BE_BUN: args[0] === "run" ? "1" : "" },
		});
		expect(result.status, result.stderr || String(result.error)).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			telemetry_selfcheck: true,
			enabled: expect.any(Boolean),
			otlp_endpoint_host: expect.any(String),
			logs_exporter: expect.any(String),
			metrics_exporter: expect.any(String),
		});
	}
}, 120_000);

async function reserveLoopbackPort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	await new Promise<void>((done) => server.close(() => done()));
	if (!address || typeof address === "string") {
		throw new Error("could not reserve a loopback port");
	}
	return address.port;
}

function processCommandLine(pid: number): string | undefined {
	if (process.platform === "win32") return undefined;
	const ps = spawnSync("ps", ["-o", "command=", "-p", String(pid)], {
		encoding: "utf8",
	});
	return ps.status === 0 ? ps.stdout.trim() : undefined;
}

async function runStartupScenario(
	extraEnv: Record<string, string>,
	options: { hubAlreadyRunning: boolean; discoveryContents?: string },
): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), "cline-desktop-startup-"));
	const discoveryPath = join(root, "hub.json");
	const stdoutPath = join(root, "stdout.log");
	const stderrPath = join(root, "stderr.log");
	const stdout = openSync(stdoutPath, "w");
	const stderr = openSync(stderrPath, "w");
	let child: ReturnType<typeof Bun.spawn> | undefined;
	let hubPid: number | undefined;
	try {
		if (options.discoveryContents !== undefined) {
			writeFileSync(discoveryPath, options.discoveryContents);
		}
		const cli = await resolveCliBinary();
		const bundle = resolveBackendBundle();

		const env = Object.fromEntries(
			Object.entries(process.env).filter(
				([key]) =>
					!/^(CLINE_|OTEL_|TELEMETRY_|ERROR_SERVICE_|BUN_BE_BUN)/.test(key) &&
					!/^(https?_proxy|all_proxy|no_proxy)$/i.test(key),
			),
		);
		Object.assign(env, {
			CLINE_DIR: root,
			CLINE_DATA_DIR: join(root, "data"),
			CLINE_HUB_DISCOVERY_PATH: discoveryPath,
			CLINE_NO_AUTO_UPDATE: "1",
			...extraEnv,
		});
		// Pin the Hub to a free port so this test cannot touch a developer's
		// real Hub even if a regression makes the backend reject the CLI's
		// discovery record.
		let existingHub: { pid: number; url: string } | undefined;
		if (options.hubAlreadyRunning) {
			// Another client (e.g. a terminal) already started the shared Hub.
			const ensure = spawnSync(
				cli,
				[
					"hub",
					"ensure",
					"--json",
					"--cwd",
					root,
					"--port",
					"0",
					"--allow-port-fallback",
					"--no-connectors",
				],
				{ cwd: root, env, encoding: "utf8", timeout: 30_000 },
			);
			expect(ensure.status, ensure.stderr || String(ensure.error)).toBe(0);
			const ensured = JSON.parse(ensure.stdout.trim().split("\n").at(-1) ?? "");
			const hub = JSON.parse(readFileSync(discoveryPath, "utf8"));
			hubPid = hub.pid;
			expect(ensured).toMatchObject({
				url: hub.url,
				authToken: hub.authToken,
			});
			env.CLINE_HUB_PORT = String(hub.port);
			existingHub = { pid: hub.pid, url: hub.url };
		} else {
			env.CLINE_HUB_PORT = String(await reserveLoopbackPort());
		}

		// The backend bundle on the CLI's runtime, started outside the
		// workspace like the packaged app does.
		child = Bun.spawn([cli, "run", "--no-env-file", bundle], {
			cwd: dirname(bundle),
			env: {
				...env,
				BUN_BE_BUN: "1",
				CLINE_DESKTOP_CLI_PATH: cli,
				CLINE_DESKTOP_WORKSPACE_ROOT: root,
			},
			stdin: "ignore",
			stdout,
			stderr,
		});
		let endpoint: string | undefined;
		let wsEndpoint: string | undefined;
		const deadline = Date.now() + 30_000;
		while (Date.now() < deadline) {
			for (const line of readFileSync(stdoutPath, "utf8").split("\n")) {
				try {
					const message = JSON.parse(line);
					if (message.type === "ready") {
						endpoint = message.endpoint;
						wsEndpoint = message.wsEndpoint;
					}
				} catch {
					/* Ignore other output and incomplete lines. */
				}
			}
			if (endpoint || child.exitCode !== null) break;
			await Bun.sleep(50);
		}
		expect(
			endpoint,
			readFileSync(stderrPath, "utf8") || "Backend never became ready",
		).toBeTruthy();
		const health = await fetch(`${endpoint}/health`, {
			signal: AbortSignal.timeout(5_000),
		});
		expect(health.ok).toBe(true);
		expect(await health.json()).toMatchObject({ ok: true, pid: child.pid });
		if (!wsEndpoint) throw new Error("Missing desktop WebSocket endpoint");
		const socket = new WebSocket(wsEndpoint);
		try {
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					socket.close();
					reject(new Error("Session service did not become ready"));
				}, 15_000);
				socket.onerror = () => {
					clearTimeout(timeout);
					reject(new Error("Desktop socket failed"));
				};
				socket.onmessage = (event) => {
					const message = JSON.parse(String(event.data));
					if (
						message.event?.name === "backend_readiness" &&
						message.event.payload.state === "ready"
					) {
						clearTimeout(timeout);
						resolve();
					}
				};
			});
		} finally {
			socket.close();
		}
		const hub = JSON.parse(readFileSync(discoveryPath, "utf8"));
		hubPid = hub.pid;
		if (existingHub) {
			// The backend attached to the running Hub instead of replacing it.
			expect(hub).toMatchObject(existingHub);
		} else {
			expect(hub.port).toBe(Number(env.CLINE_HUB_PORT));
		}
		// Either way the Hub daemon is the bundled CLI, not the backend.
		expect(hub.pid).not.toBe(child.pid);
		const hubCommand = processCommandLine(hub.pid);
		if (hubCommand !== undefined) {
			expect(hubCommand).toContain(cli);
			expect(hubCommand).toContain("--cline-hub-daemon");
		}
	} finally {
		if (child && child.exitCode === null) {
			child.kill();
			await Promise.race([child.exited, Bun.sleep(6_000)]);
			if (child.exitCode === null) child.kill("SIGKILL");
			await child.exited;
		}
		// A failed start may still have published a discovery record.
		try {
			hubPid ??= JSON.parse(readFileSync(discoveryPath, "utf8")).pid;
			if (hubPid) process.kill(hubPid, "SIGTERM");
		} catch {
			/* The isolated Hub may already have exited. */
		}
		// Windows refuses to remove a directory that is any live process's cwd,
		// and the Hub runs with `root` as its cwd. The kill above only requests
		// termination, so wait for the pid to actually go away; on POSIX the
		// remove would have succeeded regardless, which is why this only ever
		// failed on the Windows runner.
		if (hubPid) {
			const gone = Date.now() + 10_000;
			while (Date.now() < gone) {
				try {
					process.kill(hubPid, 0);
				} catch {
					break;
				}
				await Bun.sleep(50);
			}
		}
		closeSync(stdout);
		closeSync(stderr);
		// Losing a temp directory must never fail a signed release build: this
		// runs after every assertion, so a lingering grandchild holding a
		// handle would otherwise fail the publish over passing tests.
		try {
			rmSync(root, {
				recursive: true,
				force: true,
				maxRetries: 20,
				retryDelay: 100,
			});
		} catch {
			/* The runner discards its temp directory anyway. */
		}
	}
}

test("desktop backend has the bundled CLI start the Hub when none is running", async () => {
	await runStartupScenario({}, { hubAlreadyRunning: false });
}, 180_000);

test("desktop backend reuses a compatible Hub the CLI already started", async () => {
	await runStartupScenario({}, { hubAlreadyRunning: true });
}, 180_000);

// Bun's fetch has no localhost proxy bypass, so a system proxy used to swallow
// the hub discovery probes (cline/cline#14265, #14292).
test("desktop startup works behind a dead HTTP(S) proxy", async () => {
	await runStartupScenario(
		{
			HTTP_PROXY: "http://127.0.0.1:9",
			HTTPS_PROXY: "http://127.0.0.1:9",
			http_proxy: "http://127.0.0.1:9",
			https_proxy: "http://127.0.0.1:9",
		},
		{ hubAlreadyRunning: false },
	);
}, 180_000);

for (const discoveryContents of ["{ invalid json", "{}"]) {
	test(`desktop startup recovers from an invalid discovery record: ${discoveryContents}`, async () => {
		await runStartupScenario(
			{},
			{ hubAlreadyRunning: false, discoveryContents },
		);
	}, 120_000);
}

test("source desktop publishes transport while hub registration hangs", async () => {
	const root = mkdtempSync(join(tmpdir(), "cline-desktop-hanging-hub-"));
	const output = join(root, "stdout.log");
	const errors = join(root, "stderr.log");
	const stdout = openSync(output, "w");
	const stderr = openSync(errors, "w");
	let registrationRequests = 0;
	const hub = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request, server) {
			if (server.upgrade(request)) return;
			return Response.json({
				...resolveHubBuildIdentity(),
				protocolVersion: CURRENT_HUB_PROTOCOL_VERSION,
				host: "127.0.0.1",
				port: server.port,
				url: `ws://127.0.0.1:${server.port}/hub`,
				authToken: "test-hub-token",
			});
		},
		websocket: {
			message(_socket, data) {
				if (JSON.parse(String(data)).envelope?.command === "client.register") {
					registrationRequests += 1;
				}
			},
		},
	});
	let child: ReturnType<typeof Bun.spawn> | undefined;
	let socket: WebSocket | undefined;
	try {
		const env = Object.fromEntries(
			Object.entries(process.env).filter(
				([key]) => !/^(CLINE_|OTEL_|TELEMETRY_|ERROR_SERVICE_)/.test(key),
			),
		);
		Object.assign(env, {
			CLINE_DIR: root,
			CLINE_DATA_DIR: join(root, "data"),
			CLINE_HUB_DISCOVERY_PATH: join(root, "hub.json"),
			CLINE_HUB_PORT: String(hub.port),
			CLINE_SIDECAR_PORT: "0",
		});
		child = Bun.spawn(
			[
				process.execPath,
				fileURLToPath(new URL("../sidecar/index.ts", import.meta.url)),
			],
			{ cwd: root, env, stdout, stderr },
		);
		let endpoint: string | undefined;
		const deadline = Date.now() + 8_000;
		while (Date.now() < deadline && !endpoint && child.exitCode === null) {
			for (const line of readFileSync(output, "utf8").split("\n")) {
				try {
					const value = JSON.parse(line);
					if (value.type === "ready") endpoint = value.wsEndpoint;
				} catch {}
			}
			if (!endpoint) await Bun.sleep(25);
		}
		expect(endpoint, readFileSync(errors, "utf8")).toBeTruthy();
		if (!endpoint) throw new Error("Desktop endpoint missing");
		const connection = new WebSocket(endpoint);
		socket = connection;
		const responses = new Map<
			string,
			(value: { ok: boolean; [key: string]: unknown }) => void
		>();
		socket.onmessage = (event) => {
			const message = JSON.parse(String(event.data));
			if (
				message?.type !== "response" ||
				typeof message.id !== "string" ||
				typeof message.ok !== "boolean" ||
				!responses.has(message.id)
			) {
				return;
			}
			const resolve = responses.get(message.id);
			if (typeof resolve === "function") {
				responses.delete(message.id);
				resolve(message);
			}
		};
		await new Promise<void>((resolve, reject) => {
			connection.onopen = () => resolve();
			connection.onerror = reject;
		});
		const command = (id: string, name: string) =>
			new Promise((resolve) => {
				responses.set(id, resolve);
				connection.send(JSON.stringify({ id, command: name }));
			});
		expect(await command("settings", "get_global_settings")).toMatchObject({
			ok: true,
		});
		expect(await command("providers", "list_provider_catalog")).toMatchObject({
			ok: true,
		});
		// Wait for the intended hang, rather than passing during shell setup
		// before an invalid fake health response has failed initialization.
		const registrationDeadline = Date.now() + 8_000;
		while (!registrationRequests && Date.now() < registrationDeadline) {
			await Bun.sleep(25);
		}
		expect(registrationRequests, readFileSync(errors, "utf8")).toBeGreaterThan(
			0,
		);
		expect(await command("hub", "list_routine_schedules")).toMatchObject({
			ok: false,
			errorCode: "SESSION_SERVICE_NOT_READY",
			readiness: { state: "starting" },
		});
	} finally {
		socket?.close();
		if (child) {
			child.kill();
			await Promise.race([child.exited, Bun.sleep(6_000)]);
			if (child.exitCode === null) child.kill("SIGKILL");
			await child.exited;
		}
		hub.stop(true);
		closeSync(stdout);
		closeSync(stderr);
		rmSync(root, { recursive: true, force: true });
	}
}, 25_000);
