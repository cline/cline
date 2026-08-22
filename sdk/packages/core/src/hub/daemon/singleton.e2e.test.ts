/**
 * Real-process proof of lock-enforced singleton ownership:
 *
 * - A second daemon for the same owner context exits with code 3 and the
 *   incumbent keeps serving, untouched — no kill, no port fight, no loop.
 * - A crashed holder leaks nothing: the kernel releases the lock with the
 *   process, and a successor acquires it immediately.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

interface ReadyDaemon {
	child: ChildProcess;
	discoveryPath: string;
	discovery: { authToken: string; url: string; pid?: number };
	exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
	stderr: () => string;
}

const tempDirs = new Set<string>();
const children = new Set<ChildProcess>();

function resolveBunExecutable(): string {
	const currentExecutable = basename(process.execPath).toLowerCase();
	if (
		(process.versions as { bun?: string }).bun ||
		currentExecutable === "bun" ||
		currentExecutable === "bun.exe"
	) {
		return process.execPath;
	}
	const configured = process.env.BUN_EXEC_PATH?.trim();
	if (configured) {
		return configured;
	}
	const installed = process.env.BUN_INSTALL?.trim();
	const executableName = process.platform === "win32" ? "bun.exe" : "bun";
	if (installed) {
		const candidate = join(installed, "bin", executableName);
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	for (const directory of process.env.PATH?.split(delimiter) ?? []) {
		const candidate = join(directory, executableName);
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	throw new Error(`Bun executable (${executableName}) was not found on PATH`);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnFixture(
	dataDir: string,
	discoveryPath: string,
): {
	child: ChildProcess;
	exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
	stderr: () => string;
} {
	const entryPath = fileURLToPath(
		new URL("./__fixtures__/singleton-daemon.ts", import.meta.url),
	);
	const child = spawn(
		resolveBunExecutable(),
		["--conditions=development", entryPath],
		{
			cwd: dataDir,
			env: {
				...process.env,
				CLINE_BUILD_ENV: "development",
				CLINE_DATA_DIR: dataDir,
				CLINE_HUB_DISCOVERY_PATH: discoveryPath,
				CLINE_HUB_TEST_PORT: "0",
				CLINE_NO_INTERACTIVE: "1",
				NO_COLOR: "1",
			},
			stdio: ["ignore", "ignore", "pipe"],
		},
	);
	children.add(child);
	let stderr = "";
	child.stderr?.setEncoding("utf8");
	child.stderr?.on("data", (chunk: string) => {
		stderr += chunk;
	});
	const exit = once(child, "exit").then(([code, signal]) => {
		children.delete(child);
		return {
			code: code as number | null,
			signal: signal as NodeJS.Signals | null,
		};
	});
	return { child, exit, stderr: () => stderr };
}

async function waitForDiscovery(
	discoveryPath: string,
	childExit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
	readStderr: () => string,
	/** A SIGKILLed predecessor leaves its record behind; skip that pid. */
	notPid?: number,
): Promise<ReadyDaemon["discovery"]> {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		try {
			const parsed = JSON.parse(
				await readFile(discoveryPath, "utf8"),
			) as Partial<ReadyDaemon["discovery"]>;
			if (
				typeof parsed.url === "string" &&
				typeof parsed.authToken === "string" &&
				(notPid === undefined || parsed.pid !== notPid)
			) {
				return {
					url: parsed.url,
					authToken: parsed.authToken,
					pid: typeof parsed.pid === "number" ? parsed.pid : undefined,
				};
			}
		} catch {
			// Startup has not published a complete atomic record yet.
		}
		const earlyExit = await Promise.race([
			childExit.then((result) => ({ result })),
			delay(25).then(() => undefined),
		]);
		if (earlyExit) {
			throw new Error(
				`Hub daemon exited before readiness (${JSON.stringify(earlyExit.result)}): ${readStderr()}`,
			);
		}
	}
	throw new Error(`Timed out waiting for daemon discovery: ${readStderr()}`);
}

async function startDaemon(existing?: {
	dataDir: string;
	discoveryPath: string;
	notPid?: number;
}): Promise<ReadyDaemon> {
	const dataDir =
		existing?.dataDir ??
		(await mkdtemp(join(tmpdir(), "cline-hub-singleton-e2e-")));
	tempDirs.add(dataDir);
	const discoveryPath =
		existing?.discoveryPath ?? join(dataDir, "hub-discovery.json");
	const { child, exit, stderr } = spawnFixture(dataDir, discoveryPath);
	const discovery = await waitForDiscovery(
		discoveryPath,
		exit,
		stderr,
		existing?.notPid,
	);
	return { child, discoveryPath, discovery, exit, stderr };
}

function toHealthUrl(webSocketUrl: string): URL {
	const url = new URL(webSocketUrl);
	url.protocol = url.protocol === "wss:" ? "https:" : "http:";
	url.pathname = "/health";
	url.search = "";
	return url;
}

afterEach(async () => {
	for (const child of children) {
		child.kill("SIGKILL");
		await Promise.race([once(child, "exit"), delay(5_000)]).catch(
			() => undefined,
		);
	}
	children.clear();
	for (const dataDir of tempDirs) {
		await rm(dataDir, { recursive: true, force: true });
	}
	tempDirs.clear();
});

describe("hub singleton lock (real processes)", () => {
	it("a second daemon exits code 3 and the incumbent keeps serving", async () => {
		const incumbent = await startDaemon();

		const challenger = spawnFixture(
			// Same owner context: same data dir + discovery path. The data dir is
			// the discovery file's parent; deriving it through a file: URL breaks
			// on Windows (`/C:/...` is not a valid spawn cwd, so spawn fails
			// ENOENT before the singleton lock is ever contested).
			dirname(incumbent.discoveryPath),
			incumbent.discoveryPath,
		);
		const challengerExit = await Promise.race([
			challenger.exit,
			delay(15_000).then(() => undefined),
		]);
		expect(challengerExit?.code).toBe(3);
		expect(challenger.stderr()).toContain("lock held by a live hub");

		// The incumbent is untouched: still serving, discovery still its own.
		const health = await fetch(toHealthUrl(incumbent.discovery.url));
		expect(health.status).toBe(200);
		const record = JSON.parse(
			await readFile(incumbent.discoveryPath, "utf8"),
		) as { url?: string };
		expect(record.url).toBe(incumbent.discovery.url);
		expect(incumbent.child.exitCode).toBeNull();
	}, 30_000);

	it("a crashed holder leaks nothing: a successor acquires immediately", async () => {
		const first = await startDaemon();
		const dataDir = [...tempDirs][tempDirs.size - 1] as string;
		// SIGKILL: no cleanup code runs; only the kernel releases the lock.
		first.child.kill("SIGKILL");
		await first.exit;

		const successor = await startDaemon({
			dataDir,
			discoveryPath: first.discoveryPath,
			notPid: first.child.pid,
		});
		expect(successor.discovery.url).not.toBe("");
		const health = await fetch(toHealthUrl(successor.discovery.url));
		expect(health.status).toBe(200);
	}, 30_000);
});
