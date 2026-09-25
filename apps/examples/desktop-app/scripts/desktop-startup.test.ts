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
		const deadline = Date.now() + 15_000;
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

// System proxies that export HTTP(S)_PROXY (Clash, v2ray, corporate setups)
// used to capture Bun's loopback fetches — hub discovery probes went to the
// proxy instead of 127.0.0.1, the healthy Hub looked unreachable, and the
// backend died with "No compatible hub runtime is available" while respawned
// daemons exited with "Hub instance lock is held by a live Hub"
// (cline/cline#14265, #14292). The backend must come up even when every
// proxy variable points at a dead proxy.
test("compiled desktop backend starts behind a dead HTTP(S) proxy", async () => {
	await runStartupScenario({
		HTTP_PROXY: "http://127.0.0.1:9",
		HTTPS_PROXY: "http://127.0.0.1:9",
		http_proxy: "http://127.0.0.1:9",
		https_proxy: "http://127.0.0.1:9",
	});
}, 100_000);
