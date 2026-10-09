import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	closeSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Exercise the actual compiled entrypoint: source-only tests miss mixed SDK
// build identities between the desktop client and its embedded Hub daemon.

let compiledBinaryDir: string | undefined;
let compiledBinary: string | undefined;

function resolveSidecarBinary(): string {
	if (process.env.CLINE_TEST_SIDECAR_BIN) {
		return resolve(process.env.CLINE_TEST_SIDECAR_BIN);
	}
	if (compiledBinary) {
		return compiledBinary;
	}
	compiledBinaryDir = mkdtempSync(join(tmpdir(), "cline-desktop-startup-bin-"));
	const binary = join(
		compiledBinaryDir,
		process.platform === "win32" ? "sidecar.exe" : "sidecar",
	);
	const build = spawnSync(
		process.execPath,
		[
			"build",
			fileURLToPath(new URL("../sidecar/index.ts", import.meta.url)),
			"--compile",
			"--no-compile-autoload-dotenv",
			"--no-compile-autoload-bunfig",
			"--compile-exec-argv=--use-system-ca",
			"--outfile",
			binary,
		],
		{ cwd: compiledBinaryDir, encoding: "utf8", timeout: 60_000 },
	);
	expect(build.status, build.stderr || String(build.error)).toBe(0);
	compiledBinary = binary;
	return binary;
}

afterAll(() => {
	if (compiledBinaryDir) {
		try {
			rmSync(compiledBinaryDir, {
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

async function runStartupScenario(
	extraEnv: Record<string, string>,
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
		const binary = resolveSidecarBinary();

		const env = Object.fromEntries(
			Object.entries(process.env).filter(
				([key]) =>
					!/^(CLINE_|OTEL_|TELEMETRY_|ERROR_SERVICE_)/.test(key) &&
					!/^(https?_proxy|all_proxy|no_proxy)$/i.test(key),
			),
		);
		Object.assign(env, {
			CLINE_DIR: root,
			CLINE_DATA_DIR: join(root, "data"),
			CLINE_HUB_DISCOVERY_PATH: discoveryPath,
			...extraEnv,
		});
		// Bootstrap on an OS-assigned port using the same executable. Pin the
		// desktop to that port so this test cannot touch a developer's real Hub,
		// even if a regression makes it reject its own discovery record.
		const bootstrap = spawnSync(
			binary,
			["--remote-hub-ensure", "--discovery-path", discoveryPath, "--cwd", root],
			{ cwd: root, env, encoding: "utf8", timeout: 20_000 },
		);
		expect(bootstrap.status, bootstrap.stderr || String(bootstrap.error)).toBe(
			0,
		);
		const hub = JSON.parse(readFileSync(discoveryPath, "utf8"));
		hubPid = hub.pid;
		env.CLINE_HUB_PORT = String(hub.port);
		child = Bun.spawn([binary], {
			cwd: root,
			env,
			stdin: "ignore",
			stdout,
			stderr,
		});
		let endpoint: string | undefined;
		let wsEndpoint: string | undefined;
		const deadline = Date.now() + 15_000;
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
			expect(JSON.parse(readFileSync(discoveryPath, "utf8")).pid).toBe(hubPid);
		} finally {
			socket.close();
		}
	} finally {
		if (child && child.exitCode === null) {
			child.kill();
			await Promise.race([child.exited, Bun.sleep(6_000)]);
			if (child.exitCode === null) child.kill("SIGKILL");
			await child.exited;
		}
		// A failed bootstrap may still have published a discovery record.
		try {
			hubPid ??= JSON.parse(readFileSync(discoveryPath, "utf8")).pid;
			if (hubPid) process.kill(hubPid, "SIGTERM");
		} catch {
			/* The isolated Hub may already have exited. */
		}
		// Windows refuses to remove a directory that is any live process's cwd,
		// and both the Hub and the backend run with `root` as theirs. The kill
		// above only requests termination, so wait for the pid to actually go
		// away; on POSIX the remove would have succeeded regardless, which is
		// why this only ever failed on the Windows runner.
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

test("compiled desktop backend publishes its endpoint with its own Hub", async () => {
	await runStartupScenario({});
}, 100_000);

// Bun's fetch has no localhost proxy bypass, so a system proxy used to swallow
// the hub discovery probes (cline/cline#14265, #14292).
test("compiled desktop backend starts behind a dead HTTP(S) proxy", async () => {
	await runStartupScenario({
		HTTP_PROXY: "http://127.0.0.1:9",
		HTTPS_PROXY: "http://127.0.0.1:9",
		http_proxy: "http://127.0.0.1:9",
		https_proxy: "http://127.0.0.1:9",
	});
}, 100_000);

test("source desktop publishes transport while hub registration hangs", async () => {
	const root = mkdtempSync(join(tmpdir(), "cline-desktop-hanging-hub-"));
	const output = join(root, "stdout.log");
	const errors = join(root, "stderr.log");
	const stdout = openSync(output, "w");
	const stderr = openSync(errors, "w");
	const hub = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request, server) {
			if (server.upgrade(request)) return;
			return new Response("pending");
		},
		websocket: { message() {} },
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
