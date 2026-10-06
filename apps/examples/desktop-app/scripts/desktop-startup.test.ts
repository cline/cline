import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	closeSync,
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
		const installDir = join(ensureBuildDir(), "installed-runtime");
		const installerDir = fileURLToPath(
			new URL("./cli-installer/", import.meta.url),
		);
		const windows = process.platform === "win32";
		const installed = spawnSync(
			windows ? "powershell.exe" : "/bin/bash",
			windows
				? [
						"-NoProfile",
						"-NonInteractive",
						"-ExecutionPolicy",
						"Bypass",
						"-File",
						join(installerDir, "install.ps1"),
						"-Binary",
						outfile,
						"-InstallDir",
						installDir,
						"-NoModifyPath",
					]
				: [
						join(installerDir, "install.sh"),
						"--binary",
						outfile,
						"--install-dir",
						installDir,
						"--no-modify-path",
					],
			{ encoding: "utf8", timeout: 30_000 },
		);
		expect(installed.status, installed.stderr || String(installed.error)).toBe(
			0,
		);
		compiledCli = join(installDir, windows ? "cline.exe" : "cline");
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

test("installed CLI exposes SDK identity and its native path without starting a Hub", async () => {
	const cli = await resolveCliBinary();
	const result = spawnSync(cli, ["--runtime-info"], {
		encoding: "utf8",
		timeout: 10_000,
	});
	expect(result.status, result.stderr).toBe(0);
	const info = JSON.parse(result.stdout);
	expect(info.compiled).toBe(true);
	expect(info.executablePath).toBe(realpathSync(cli));
	expect(info.buildId).toBeTruthy();
	expect(info.coreVersion).toBeTruthy();
	for (const [flag, expected] of [
		["--runtime-path", realpathSync(cli)],
		["--runtime-build-id", info.buildId],
	]) {
		const probe = spawnSync(cli, [flag], { encoding: "utf8", timeout: 10_000 });
		expect(probe.status).toBe(0);
		expect(probe.stdout.trim()).toBe(expected);
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
		const deadline = Date.now() + 30_000;
		while (Date.now() < deadline) {
			for (const line of readFileSync(stdoutPath, "utf8").split("\n")) {
				try {
					const message = JSON.parse(line);
					if (message.type === "ready") endpoint = message.endpoint;
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
		const hub = JSON.parse(readFileSync(discoveryPath, "utf8"));
		hubPid = hub.pid;
		if (existingHub) {
			// The backend attached to the running Hub instead of replacing it.
			expect(hub).toMatchObject(existingHub);
		} else {
			expect(hub.port).toBe(Number(env.CLINE_HUB_PORT));
		}
		// Either way the Hub daemon is the installed CLI, not the backend.
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

test("desktop backend has the installed CLI start the Hub when none is running", async () => {
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
