import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { CLINE_HUB_DEV_PORT } from "@cline/shared";
import { resolveSdkRuntimeBuildId } from "../../../../sdk/packages/core/scripts/runtime-build-id";

// Exercise the actual compiled binary from outside the checkout, without an
// existing Hub or runtime identity overrides. Source tests cannot catch missing
// build-time defines in the sidecar or its embedded daemon entrypoint.
const binary = process.argv[2];
assert(binary, "usage: bun run scripts/verify-sidecar-startup.ts <binary>");
const expectedBuildId = resolveSdkRuntimeBuildId(
	fileURLToPath(new URL("../../../../", import.meta.url)),
);

async function availablePort(port = 0): Promise<number> {
	const server = createServer();
	server.listen(port, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert(address && typeof address !== "string");
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
	return address.port;
}

async function main(): Promise<void> {
	// Refuse to touch a developer's running Hub. Keep the normal managed-port
	// path: CLINE_HUB_PORT is an explicit endpoint with different auth semantics.
	await availablePort(CLINE_HUB_DEV_PORT);
	const sidecarPort = await availablePort();
	const directory = await mkdtemp(join(tmpdir(), "cline-sidecar-startup-"));
	const discoveryPath = join(directory, "hub.json");
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) =>
			[
				"PATH",
				"SHELL",
				"SystemRoot",
				"SYSTEMROOT",
				"WINDIR",
				"COMSPEC",
				"PATHEXT",
				"TMP",
				"TEMP",
				"TMPDIR",
			].includes(key),
		),
	);
	Object.assign(env, {
		CLINE_BUILD_ENV: "development",
		CLINE_DIR: directory,
		CLINE_DATA_DIR: join(directory, "data"),
		CLINE_HUB_DISCOVERY_PATH: discoveryPath,
		CLINE_SIDECAR_PORT: String(sidecarPort),
	});

	const child = spawn(resolve(binary), [], {
		cwd: directory,
		env,
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	const exited = once(child, "exit");
	let stderr = "";
	child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
		stderr += chunk;
	});
	const lines = createInterface({ input: child.stdout });
	let deadline: ReturnType<typeof setTimeout> | undefined;
	try {
		const ready = await Promise.race([
			(async () => {
				for await (const line of lines) {
					let message: { type?: string; endpoint?: string };
					try {
						message = JSON.parse(line);
					} catch {
						continue;
					}
					if (message.type === "ready" && message.endpoint) {
						return message.endpoint;
					}
				}
				throw new Error(
					`Sidecar exited before publishing its endpoint: ${stderr}`,
				);
			})(),
			new Promise<never>((_, reject) => {
				deadline = setTimeout(
					() => reject(new Error("Sidecar startup timed out")),
					30_000,
				);
			}),
		]);
		const health = await fetch(`${ready}/health`, {
			signal: AbortSignal.timeout(5_000),
		});
		assert(health.ok, "sidecar health request failed");
		assert.equal((await health.json()).ok, true);
		const discovery = JSON.parse(await readFile(discoveryPath, "utf8"));
		assert.equal(
			discovery.buildId,
			expectedBuildId,
			"packaged Hub identity must match SDK sources",
		);
		assert(
			discovery.buildEpochMs > 0,
			"packaged Hub must carry its build epoch",
		);
		assert(
			discovery.pid > 0 && discovery.pid !== child.pid,
			"sidecar must start a detached Hub",
		);
		console.log(
			"Packaged sidecar cold start passed: detached Hub, embedded identity, ready endpoint, and health.",
		);
	} catch (error) {
		console.error(
			await readFile(join(directory, "data/logs/hub-daemon.log"), "utf8").catch(
				() => "",
			),
		);
		throw error;
	} finally {
		clearTimeout(deadline);
		lines.close();
		// The Hub outlives its client. Clean up both processes even on a failed test.
		if (child.exitCode === null && child.signalCode === null) child.kill();
		const killTimeout = setTimeout(() => child.kill("SIGKILL"), 7_000);
		await exited;
		clearTimeout(killTimeout);
		const discovery = await readFile(discoveryPath, "utf8")
			.then(JSON.parse)
			.catch(() => undefined);
		if (discovery) {
			const url = new URL(discovery.url);
			url.protocol = "http:";
			url.pathname = "/shutdown";
			const response = await fetch(url, {
				method: "POST",
				headers: { authorization: `Bearer ${discovery.authToken}` },
				signal: AbortSignal.timeout(5_000),
			});
			assert(response.ok, "test Hub shutdown failed");
			// Wait for the daemon to release its database files before cleanup (Windows).
			for (let attempt = 0; attempt < 100; attempt++) {
				try {
					process.kill(discovery.pid, 0);
				} catch {
					break;
				}
				await Bun.sleep(100);
			}
		}
		await rm(directory, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 200,
		});
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
