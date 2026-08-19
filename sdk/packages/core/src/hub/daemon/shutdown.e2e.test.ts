import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

interface ReadyDaemon {
	child: ChildProcess;
	discoveryPath: string;
	discovery: {
		authToken: string;
		url: string;
		pid?: number;
	};
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

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	label: string,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`Timed out waiting for ${label}`)),
					timeoutMs,
				);
				timer.unref?.();
			}),
		]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}

async function waitForDiscovery(
	discoveryPath: string,
	childExit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
	readStderr: () => string,
): Promise<ReadyDaemon["discovery"]> {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		try {
			const parsed = JSON.parse(
				await readFile(discoveryPath, "utf8"),
			) as Partial<ReadyDaemon["discovery"]>;
			if (
				typeof parsed.url === "string" &&
				typeof parsed.authToken === "string"
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

async function startDaemon(): Promise<ReadyDaemon> {
	const dataDir = await mkdtemp(join(tmpdir(), "cline-hub-shutdown-e2e-"));
	tempDirs.add(dataDir);
	const discoveryPath = join(dataDir, "hub-discovery.json");
	const entryPath = fileURLToPath(
		new URL("./__fixtures__/shutdown-daemon.ts", import.meta.url),
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
	const spawnError = once(child, "error").then(([error]) => {
		throw error;
	});
	const readStderr = () => stderr;
	const discovery = await Promise.race([
		waitForDiscovery(discoveryPath, exit, readStderr),
		spawnError,
	]);
	return { child, discoveryPath, discovery, exit, stderr: readStderr };
}

async function openAuthenticatedSocket(
	url: string,
	authToken: string,
): Promise<WebSocket> {
	const socket = new WebSocket(url, `cline-hub-auth.${authToken}`);
	await withTimeout(
		once(socket, "open").then(() => undefined),
		5_000,
		"WebSocket",
	);
	return socket;
}

function toHttpUrl(webSocketUrl: string, pathname: string): URL {
	const url = new URL(webSocketUrl);
	url.protocol = url.protocol === "wss:" ? "https:" : "http:";
	url.pathname = pathname;
	url.search = "";
	url.hash = "";
	return url;
}

afterEach(async () => {
	for (const child of children) {
		child.kill("SIGKILL");
		await withTimeout(
			once(child, "exit").then(() => undefined),
			5_000,
			"cleanup",
		).catch(() => undefined);
	}
	children.clear();
	for (const dataDir of tempDirs) {
		await rm(dataDir, { recursive: true, force: true });
	}
	tempDirs.clear();
});

describe("hub daemon shutdown", () => {
	it("exits the real process after authenticated HTTP shutdown with an open WebSocket", async () => {
		const daemon = await startDaemon();
		expect(daemon.discovery.pid).toBe(daemon.child.pid);
		const socket = await openAuthenticatedSocket(
			daemon.discovery.url,
			daemon.discovery.authToken,
		);
		try {
			const startedAt = Date.now();
			const response = await fetch(
				toHttpUrl(daemon.discovery.url, "/shutdown"),
				{
					method: "POST",
					headers: {
						authorization: `Bearer ${daemon.discovery.authToken}`,
					},
				},
			);
			expect(response.status).toBe(202);
			const result = await withTimeout(daemon.exit, 5_000, "daemon exit");
			expect(result).toEqual({ code: 0, signal: null });
			expect(Date.now() - startedAt).toBeLessThan(5_000);
			expect(daemon.stderr()).toContain(
				"[shutdown-fixture] runtime: bun 1.3.13",
			);
			expect(daemon.stderr()).toContain("[shutdown-fixture] forced exit:");
			await expect(
				readFile(daemon.discoveryPath, "utf8"),
			).rejects.toMatchObject({
				code: "ENOENT",
			});
			const endpointReachable = await fetch(
				toHttpUrl(daemon.discovery.url, "/health"),
			).then(
				() => true,
				() => false,
			);
			expect(endpointReachable).toBe(false);
		} finally {
			socket.terminate();
		}
	});

	it.skipIf(process.platform === "win32")(
		"exits the real process after SIGTERM with an open WebSocket",
		async () => {
			const daemon = await startDaemon();
			const socket = await openAuthenticatedSocket(
				daemon.discovery.url,
				daemon.discovery.authToken,
			);
			try {
				const startedAt = Date.now();
				daemon.child.kill("SIGTERM");
				const result = await withTimeout(daemon.exit, 5_000, "daemon exit");
				expect(result).toEqual({ code: 0, signal: null });
				expect(Date.now() - startedAt).toBeLessThan(5_000);
				expect(daemon.stderr()).toContain(
					"[shutdown-fixture] runtime: bun 1.3.13",
				);
				expect(daemon.stderr()).toContain("[shutdown-fixture] forced exit:");
				await expect(
					readFile(daemon.discoveryPath, "utf8"),
				).rejects.toMatchObject({ code: "ENOENT" });
			} finally {
				socket.terminate();
			}
		},
	);
});
