import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	closeSync,
	copyFileSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
		cpSync(
			fileURLToPath(
				new URL(
					"../../../../sdk/packages/core/dist/plugin-runtime",
					import.meta.url,
				),
			),
			join(outdir, "plugin-runtime"),
			{ recursive: true },
		);
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
			traces_exporter: expect.any(String),
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

function waitForHubStartup(wsEndpoint: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(wsEndpoint);
		const timer = setTimeout(() => {
			socket.close();
			reject(new Error("Hub startup did not settle within 30 seconds"));
		}, 30_000);
		socket.onmessage = (event) => {
			const message = JSON.parse(String(event.data));
			const state = message.event?.payload?.state;
			if (message.event?.name === "hub_status" && state !== "starting") {
				clearTimeout(timer);
				socket.close();
				resolve(state);
			}
		};
		socket.onerror = () => {
			clearTimeout(timer);
			reject(new Error(`Could not connect to ${wsEndpoint}`));
		};
	});
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
		child = Bun.spawn(
			[cli, "run", "--use-system-ca", "--no-env-file", bundle],
			{
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
			},
		);
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
		// The backend publishes its endpoint before starting the Hub and reports
		// Hub startup over the transport, replaying the current state on connect.
		expect(await waitForHubStartup(String(wsEndpoint)), stderrPath).toBe(
			"ready",
		);
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

test.each([
	"worker",
	"sandbox",
])("standalone CLI loads an SDK plugin without Node (%s)", async (mode) => {
	const cli = await resolveCliBinary();
	const root = mkdtempSync(join(tmpdir(), "cline-plugin-installed-"));
	try {
		const directory = join(root, ".cline", "plugins");
		mkdirSync(directory, { recursive: true });
		// Occupy the old cache path: startup must succeed without extraction.
		writeFileSync(join(root, ".cline", "runtime"), "no extraction");
		const marker = join(root, "plugin-result.json");
		// Copy the raw TypeScript fixture so SDK imports must resolve from the
		// packaged runtime, outside the monorepo and without prebundling.
		copyFileSync(
			fileURLToPath(
				new URL("./fixtures/embedded-plugin/smoke.ts", import.meta.url),
			),
			join(directory, "smoke.ts"),
		);
		const env = Object.fromEntries(
			Object.entries(process.env).filter(
				([key]) =>
					!/^(CLINE_|BUN_BE_BUN|NODE_PATH|npm_node_execpath|NODE$|BUN_EXEC_PATH)/.test(
						key,
					),
			),
		);
		const result = spawnSync(cli, ["config", "tools", "--json"], {
			cwd: root,
			encoding: "utf8",
			timeout: 30000,
			env: {
				...env,
				HOME: root,
				USERPROFILE: root,
				CLINE_DIR: join(root, ".cline"),
				PATH: root,
				JITI_FS_CACHE: "false",
				CLINE_PLUGIN_MODE: mode,
				// Cold Windows runners can take more than the 4s default to start a
				// sandbox child; this test covers resource loading, not startup time.
				CLINE_PLUGIN_IMPORT_TIMEOUT_MS: "20000",
				CLINE_TEST_PLUGIN_RESULT_PATH: marker,
				TMPDIR: root,
				CLINE_NO_AUTO_UPDATE: "1",
			},
		});
		expect(result.status, result.stderr || String(result.error)).toBe(0);
		expect(
			JSON.parse(result.stdout).some(
				(tool: { name: string }) => tool.name === "embedded_ping",
			),
		).toBe(true);
		expect(readFileSync(join(root, ".cline", "runtime"), "utf8")).toBe(
			"no extraction",
		);
		expect(JSON.parse(readFileSync(marker, "utf8"))).toEqual({
			pong: true,
			// The native resolver expands Windows 8.3 short names (RUNNER~1), as
			// the child's process.execPath does.
			execPath: realpathSync.native(cli),
			isMainThread: mode === "sandbox",
			bunRuntimeFlag: null,
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}, 120000);

test.each([
	"worker",
	"sandbox",
])("packaged desktop backend loads its on-disk SDK runtime (%s)", async (mode) => {
	const cli = await resolveCliBinary();
	const outdir = dirname(resolveBackendBundle());
	const probe = join(outdir, "plugin-runtime-probe.js");
	const built = await Bun.build({
		entrypoints: [
			fileURLToPath(
				new URL("./fixtures/desktop-plugin-runtime.ts", import.meta.url),
			),
		],
		target: "bun",
		outdir,
		naming: "plugin-runtime-probe.js",
	});
	expect(built.success, built.logs.map(String).join("\n")).toBe(true);
	const root = mkdtempSync(join(tmpdir(), "cline-desktop-plugin-"));
	try {
		const plugins = join(root, ".cline", "plugins");
		mkdirSync(plugins, { recursive: true });
		copyFileSync(
			fileURLToPath(
				new URL("./fixtures/embedded-plugin/desktop.ts", import.meta.url),
			),
			join(plugins, "desktop.ts"),
		);
		writeFileSync(join(root, ".cline", "runtime"), "no extraction");
		const env = Object.fromEntries(
			Object.entries(process.env).filter(
				([key]) =>
					!/^(CLINE_|BUN_BE_BUN|NODE_PATH|npm_node_execpath|NODE$|BUN_EXEC_PATH)/.test(
						key,
					),
			),
		);
		const result = spawnSync(
			cli,
			["run", "--use-system-ca", "--no-env-file", probe],
			{
				cwd: root,
				encoding: "utf8",
				timeout: 30000,
				env: {
					...env,
					PATH: root,
					HOME: root,
					USERPROFILE: root,
					CLINE_DIR: join(root, ".cline"),
					BUN_BE_BUN: "1",
					CLINE_DESKTOP_CLI_PATH: cli,
					CLINE_PLUGIN_MODE: mode,
					JITI_FS_CACHE: "false",
				},
			},
		);
		expect(result.status, result.stderr || String(result.error)).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			commands: [{ name: "packaged-ping" }],
			result: { reply: "pong" },
		});
		expect(readFileSync(join(root, ".cline", "runtime"), "utf8")).toBe(
			"no extraction",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}, 120000);

test("standalone CLI serves the dashboard and its assets without external files or Node", async () => {
	const cli = await resolveCliBinary();
	const root = mkdtempSync(join(tmpdir(), "cline-standalone-dashboard-"));
	mkdirSync(join(root, ".cline"));
	writeFileSync(join(root, ".cline", "runtime"), "no extraction");
	const env = Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) =>
				!/^(CLINE_|BUN_BE_BUN|NODE_PATH|HOST$|PORT$|ROOM_SECRET$|PUBLIC_URL$)/.test(
					key,
				),
		),
	);
	const port = await reserveLoopbackPort();
	const isolatedEnv = {
		...env,
		HOME: root,
		USERPROFILE: root,
		CLINE_DIR: join(root, ".cline"),
		CLINE_HUB_DISCOVERY_PATH: join(root, "hub.json"),
		CLINE_HUB_PORT: String(await reserveLoopbackPort()),
		CLINE_NO_AUTO_UPDATE: "1",
		PATH: root,
	};
	const child = Bun.spawn(
		[
			cli,
			"dashboard",
			"--no-open",
			"--host",
			"127.0.0.1",
			"--port",
			String(port),
			"--cwd",
			root,
		],
		{ cwd: root, env: isolatedEnv, stdout: "ignore", stderr: "pipe" },
	);
	try {
		const url = `http://127.0.0.1:${port}`;
		let response: Response | undefined;
		const deadline = Date.now() + 20000;
		while (Date.now() < deadline) {
			try {
				response = await fetch(url);
				if (response.status === 200) break;
			} catch {}
			if (child.exitCode !== null)
				throw new Error(await new Response(child.stderr).text());
			await Bun.sleep(100);
		}
		expect(response?.status).toBe(200);
		if (!response) throw new Error("Dashboard did not start");
		expect(readFileSync(join(root, ".cline", "runtime"), "utf8")).toBe(
			"no extraction",
		);
		const html = await response.text();
		expect(html).toContain("<html");
		const assets = [
			...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g),
		].map((match) => match[1]);
		expect(assets.length).toBeGreaterThan(0);
		for (const asset of assets) {
			if (!asset) throw new Error("Missing dashboard asset URL");
			const resource = await fetch(new URL(asset, url));
			expect(resource.status).toBe(200);
			expect(resource.headers.get("content-type")).toMatch(
				asset.endsWith(".css") ? /text\/css/ : /(?:javascript|ecmascript)/,
			);
			expect((await resource.arrayBuffer()).byteLength).toBeGreaterThan(0);
		}
	} finally {
		child.kill("SIGTERM");
		await child.exited;
		spawnSync(cli, ["hub", "stop"], {
			cwd: root,
			env: isolatedEnv,
			timeout: 10000,
		});
		// The stopped Hub can hold its cwd briefly on Windows (EBUSY).
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
}, 120000);
