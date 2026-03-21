import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { resolveClineDataDir } from "@clinebot/core";
import {
	createSqliteRpcSessionBackend,
	tryAcquireRpcSpawnLease,
} from "@clinebot/core/node";
import {
	getRpcServerHealth,
	RpcSessionClient,
	registerRpcClient,
	requestRpcServerShutdown,
	startRpcServer,
	stopRpcServer,
} from "@clinebot/rpc";
import { Command } from "commander";
import { createCliLoggerAdapter } from "../logging/adapter";
import { logSpawnedProcess } from "../logging/process";
import { createRpcRuntimeHandlers } from "./rpc-runtime";

const c = {
	dim: "\x1b[2m",
	reset: "\x1b[0m",
};

const RPC_STARTUP_LOCK_MAX_AGE_MS = 30_000;
const RPC_STARTUP_LOCK_WAIT_MS = 15_000;
const RPC_STARTUP_LOCK_POLL_MS = 100;
const RPC_STARTUP_LOCK_BYPASS_ENV = "CLINE_RPC_STARTUP_LOCK_HELD";

type RpcStartupLockRecord = {
	pid: number;
	address: string;
	acquiredAt: string;
};

type EnsureCompatibleRpcAddressOptions = {
	forceKillIncompatible?: boolean;
	lockHeld?: boolean;
};

const DEFAULT_RPC_ADDRESS = "127.0.0.1:4317";

interface RpcCommandIo {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
}

function collectMeta(value: string, previous: string[]): string[] {
	return previous.concat(value);
}

function parseMetaEntries(entries: string[]): Record<string, string> {
	const metadata: Record<string, string> = {};
	for (const raw of entries) {
		const trimmed = raw.trim();
		const separator = trimmed.indexOf("=");
		if (separator <= 0 || separator >= trimmed.length - 1) {
			continue;
		}
		const key = trimmed.slice(0, separator).trim();
		const value = trimmed.slice(separator + 1).trim();
		if (!key || !value) {
			continue;
		}
		metadata[key] = value;
	}
	return metadata;
}
function parseRpcAddress(address: string): { host: string; port: number } {
	const trimmed = address.trim();
	const idx = trimmed.lastIndexOf(":");
	if (idx <= 0 || idx >= trimmed.length - 1) {
		throw new Error(`invalid rpc address: ${address}`);
	}
	const host = trimmed.slice(0, idx);
	const port = Number.parseInt(trimmed.slice(idx + 1), 10);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		throw new Error(`invalid rpc port in address: ${address}`);
	}
	return { host, port };
}

function isUnimplementedError(error: unknown): boolean {
	if (error && typeof error === "object" && "code" in error) {
		const code = Number((error as { code?: unknown }).code);
		if (code === 12) {
			return true;
		}
	}
	const message = error instanceof Error ? error.message : String(error);
	return message.toUpperCase().includes("UNIMPLEMENTED");
}

async function hasRuntimeMethods(address: string): Promise<boolean> {
	const client = new RpcSessionClient({ address });
	try {
		// Probe a runtime-only method without creating any session side effects.
		try {
			await client.stopRuntimeSession("__rpc_probe__");
		} catch (error) {
			if (isUnimplementedError(error)) {
				return false;
			}
		}
		return true;
	} catch (error) {
		return !isUnimplementedError(error);
	} finally {
		client.close();
	}
}

async function isPortFree(host: string, port: number): Promise<boolean> {
	return await new Promise<boolean>((resolve) => {
		const server = createServer();
		server.once("error", () => resolve(false));
		server.once("listening", () => {
			server.close(() => resolve(true));
		});
		server.listen({ host, port });
	});
}

async function findAvailableAddress(baseAddress: string): Promise<string> {
	const { host, port } = parseRpcAddress(baseAddress);
	for (let offset = 1; offset <= 40; offset += 1) {
		const candidatePort = port + offset;
		if (candidatePort > 65535) {
			break;
		}
		if (await isPortFree(host, candidatePort)) {
			return `${host}:${candidatePort}`;
		}
	}
	throw new Error(`no available rpc port near ${baseAddress}`);
}

function getRpcStartupLockDir(address: string): string {
	const normalized = address.trim().replace(/[^a-zA-Z0-9_.-]+/g, "_");
	return join(resolveClineDataDir(), "locks", `rpc-start-${normalized}.lock`);
}

async function writeRpcStartupLockRecord(
	lockDir: string,
	address: string,
): Promise<void> {
	const record: RpcStartupLockRecord = {
		pid: process.pid,
		address,
		acquiredAt: new Date().toISOString(),
	};
	await writeFile(
		join(lockDir, "owner.json"),
		JSON.stringify(record, null, 2),
		"utf8",
	);
}

function isPidAlive(pid: number | undefined): boolean {
	const normalizedPid = Number.isInteger(pid) ? pid : undefined;
	if (normalizedPid === undefined || normalizedPid <= 0) {
		return false;
	}
	try {
		process.kill(normalizedPid, 0);
		return true;
	} catch (error) {
		const code =
			error && typeof error === "object" && "code" in error
				? String((error as { code?: unknown }).code)
				: "";
		return code === "EPERM";
	}
}

async function removeRpcStartupLockDir(lockDir: string): Promise<void> {
	try {
		await rm(lockDir, { recursive: true, force: true });
	} catch {
		// Best-effort cleanup only.
	}
}

async function readRpcStartupLockRecord(
	lockDir: string,
): Promise<RpcStartupLockRecord | undefined> {
	try {
		const raw = await readFile(join(lockDir, "owner.json"), "utf8");
		const parsed = JSON.parse(raw) as Partial<RpcStartupLockRecord>;
		if (
			typeof parsed.pid !== "number" ||
			typeof parsed.address !== "string" ||
			typeof parsed.acquiredAt !== "string"
		) {
			return undefined;
		}
		return {
			pid: parsed.pid,
			address: parsed.address,
			acquiredAt: parsed.acquiredAt,
		};
	} catch {
		return undefined;
	}
}

async function withRpcStartupLock<T>(
	address: string,
	action: () => Promise<T>,
): Promise<T> {
	if (process.env[RPC_STARTUP_LOCK_BYPASS_ENV] === "1") {
		return await action();
	}

	const lockDir = getRpcStartupLockDir(address);
	const startedAt = Date.now();
	await mkdir(dirname(lockDir), { recursive: true });

	while (true) {
		try {
			await mkdir(lockDir, { recursive: false });
			await writeRpcStartupLockRecord(lockDir, address);
			try {
				return await action();
			} finally {
				await removeRpcStartupLockDir(lockDir);
			}
		} catch (error) {
			const code =
				error && typeof error === "object" && "code" in error
					? String((error as { code?: unknown }).code)
					: "";
			if (code !== "EEXIST") {
				throw error;
			}

			const existing = await readRpcStartupLockRecord(lockDir);
			const acquiredAtMs = existing
				? new Date(existing.acquiredAt).getTime()
				: Number.NaN;
			const isStale =
				!existing ||
				!Number.isFinite(acquiredAtMs) ||
				Date.now() - acquiredAtMs > RPC_STARTUP_LOCK_MAX_AGE_MS ||
				!isPidAlive(existing.pid);
			if (isStale) {
				await removeRpcStartupLockDir(lockDir);
				continue;
			}

			if (Date.now() - startedAt >= RPC_STARTUP_LOCK_WAIT_MS) {
				throw new Error(
					`timed out waiting for rpc startup lock at ${address} (owner pid=${existing.pid})`,
				);
			}
			await new Promise((resolve) =>
				setTimeout(resolve, RPC_STARTUP_LOCK_POLL_MS),
			);
		}
	}
}

function spawnRpcStartDetached(address: string): void {
	const lease = tryAcquireRpcSpawnLease(address);
	if (!lease) {
		return;
	}
	const launcher = process.execPath;
	const entryArg = process.argv[1];
	const entry = entryArg?.trim()
		? isAbsolute(entryArg)
			? entryArg
			: resolvePath(process.cwd(), entryArg)
		: undefined;
	if (!entry) {
		lease.release();
		throw new Error("unable to resolve CLI entrypoint for detached rpc start");
	}
	const conditionsArg = process.execArgv.find((arg) =>
		arg.startsWith("--conditions="),
	);
	const childArgs = [
		...(conditionsArg ? [conditionsArg] : []),
		entry,
		"rpc",
		"start",
		"--address",
		address,
	];
	const child = spawn(launcher, childArgs, {
		detached: true,
		stdio: "ignore",
		env: {
			...process.env,
			[RPC_STARTUP_LOCK_BYPASS_ENV]: "1",
		},
		cwd: process.cwd(),
	});
	logSpawnedProcess({
		component: "rpc",
		command: [launcher, ...childArgs],
		childPid: child.pid ?? undefined,
		detached: true,
		cwd: process.cwd(),
		metadata: { rpcAddress: address, purpose: "rpc.start.background" },
	});
	child.unref();
	setTimeout(() => lease.release(), 10_000).unref();
}

function forceKillListener(address: string): number {
	const { port } = parseRpcAddress(address);
	if (process.platform === "win32") {
		const list = spawnSync("cmd", ["/c", "netstat -ano -p tcp"], {
			encoding: "utf8",
		});
		if (list.status !== 0) {
			return 0;
		}
		const pids = new Set<number>();
		for (const line of (list.stdout || "").split(/\r?\n/)) {
			if (!line.includes(`:${port}`) || !line.includes("LISTENING")) {
				continue;
			}
			const parts = line.trim().split(/\s+/);
			const pid = Number.parseInt(parts[parts.length - 1] || "", 10);
			if (Number.isInteger(pid) && pid > 0) {
				pids.add(pid);
			}
		}
		for (const pid of pids) {
			spawnSync("taskkill", ["/PID", String(pid), "/F"], { encoding: "utf8" });
		}
		return pids.size;
	}

	const out = spawnSync("lsof", ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"], {
		encoding: "utf8",
	});
	if (out.status !== 0) {
		return 0;
	}
	const pids = (out.stdout || "")
		.split(/\r?\n/)
		.map((line) => Number.parseInt(line.trim(), 10))
		.filter((pid) => Number.isInteger(pid) && pid > 0);
	for (const pid of pids) {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// best effort
		}
	}
	return pids.length;
}

async function waitForRuntimeReady(address: string): Promise<boolean> {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		const health = await getRpcServerHealth(address);
		if (health?.running && (await hasRuntimeMethods(address))) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return false;
}

async function ensureCompatibleRpcAddress(
	requestedAddress: string,
	options?: EnsureCompatibleRpcAddressOptions,
): Promise<{ address: string; action: "reuse" | "new-port" | "started" }> {
	if (!options?.lockHeld) {
		return await withRpcStartupLock(requestedAddress, async () =>
			ensureCompatibleRpcAddress(requestedAddress, {
				...options,
				lockHeld: true,
			}),
		);
	}

	const health = await getRpcServerHealth(requestedAddress);
	if (!health?.running) {
		const { host, port } = parseRpcAddress(requestedAddress);
		const requestedPortFree = await isPortFree(host, port);
		if (!requestedPortFree && options?.forceKillIncompatible) {
			forceKillListener(requestedAddress);
			const listenerStillHealthy =
				(await getRpcServerHealth(requestedAddress))?.running === true;
			if (!listenerStillHealthy && (await isPortFree(host, port))) {
				return { address: requestedAddress, action: "started" };
			}
			throw new Error(
				`rpc address ${requestedAddress} is still occupied after replacing the unhealthy listener`,
			);
		}
		return { address: requestedAddress, action: "started" };
	}
	if (await hasRuntimeMethods(requestedAddress)) {
		return { address: requestedAddress, action: "reuse" };
	}

	if (options?.forceKillIncompatible) {
		const shutdown = await requestRpcServerShutdown(requestedAddress);
		if (shutdown?.accepted) {
			for (let attempt = 0; attempt < 20; attempt += 1) {
				if (!(await getRpcServerHealth(requestedAddress))?.running) {
					return { address: requestedAddress, action: "started" };
				}
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}
		forceKillListener(requestedAddress);
		const { host, port } = parseRpcAddress(requestedAddress);
		const listenerStillHealthy =
			(await getRpcServerHealth(requestedAddress))?.running === true;
		if (!listenerStillHealthy && (await isPortFree(host, port))) {
			return { address: requestedAddress, action: "started" };
		}
		throw new Error(
			`rpc address ${requestedAddress} is still occupied after replacing the unhealthy listener`,
		);
	}

	return {
		address: await findAvailableAddress(requestedAddress),
		action: "new-port",
	};
}

export async function ensureRpcRuntimeAddress(
	requestedAddress: string,
): Promise<string> {
	return await withRpcStartupLock(requestedAddress, async () => {
		const ensured = await ensureCompatibleRpcAddress(requestedAddress, {
			forceKillIncompatible: true,
			lockHeld: true,
		});
		return await ensureRpcRuntimeAddressFromResolved(ensured);
	});
}

async function ensureRpcRuntimeAddressFromResolved(ensured: {
	address: string;
	action: "reuse" | "new-port" | "started";
}): Promise<string> {
	if (ensured.action !== "reuse") {
		spawnRpcStartDetached(ensured.address);
	}

	if (!(await waitForRuntimeReady(ensured.address))) {
		throw new Error(`failed to ensure rpc runtime at ${ensured.address}`);
	}

	return ensured.address;
}

function formatUptime(startedAt: string): string {
	const startMs = new Date(startedAt).getTime();
	if (!Number.isFinite(startMs)) {
		return "unknown";
	}
	let seconds = Math.floor((Date.now() - startMs) / 1000);
	if (seconds < 0) {
		return "0s";
	}
	const days = Math.floor(seconds / 86400);
	seconds %= 86400;
	const hours = Math.floor(seconds / 3600);
	seconds %= 3600;
	const minutes = Math.floor(seconds / 60);
	seconds %= 60;
	const parts: string[] = [];
	if (days > 0) {
		parts.push(`${days}d`);
	}
	if (hours > 0) {
		parts.push(`${hours}h`);
	}
	if (minutes > 0) {
		parts.push(`${minutes}m`);
	}
	parts.push(`${seconds}s`);
	return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Exported command handlers — accept parsed options instead of rawArgs
// ---------------------------------------------------------------------------

export async function runRpcEnsureCommand(
	options: { address: string; json?: boolean },
	writeln: (text?: string) => void,
	writeErr: (text: string) => void,
): Promise<number> {
	const requestedAddress = options.address;
	const jsonOutput = !!options.json;
	let ensured:
		| { address: string; action: "reuse" | "new-port" | "started" }
		| undefined;
	try {
		await withRpcStartupLock(requestedAddress, async () => {
			ensured = await ensureCompatibleRpcAddress(requestedAddress, {
				forceKillIncompatible: true,
				lockHeld: true,
			});
			await ensureRpcRuntimeAddressFromResolved(ensured);
		});
	} catch (error) {
		writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
	if (!ensured) {
		writeErr(`failed to ensure rpc runtime at ${requestedAddress}`);
		return 1;
	}

	if (jsonOutput) {
		writeln(
			JSON.stringify({
				running: true,
				requestedAddress,
				address: ensured.address,
				action: ensured.action,
			}),
		);
	} else {
		writeln(
			`${c.dim}[rpc] ensured address=${ensured.address} (requested=${requestedAddress}, action=${ensured.action})${c.reset}`,
		);
	}
	return 0;
}

async function runRpcStartCommand(
	options: { address: string },
	writeln: (text?: string) => void,
	writeErr: (text: string) => void,
): Promise<number> {
	const startupLogger = createCliLoggerAdapter({
		runtime: "cli",
		component: "rpc-start",
	}).core;
	const normalizedAddress = options.address;
	if (!normalizedAddress) {
		writeErr("rpc start requires a non-empty address");
		startupLogger.error?.("RPC start rejected: empty address");
		return 1;
	}

	let startAddress = normalizedAddress;
	let handle: Awaited<ReturnType<typeof startRpcServer>> | undefined;
	let reusedExisting = false;
	let existingServerId: string | undefined;
	let startedAction: "new-port" | "started" = "started";
	await withRpcStartupLock(normalizedAddress, async () => {
		const ensured = await ensureCompatibleRpcAddress(normalizedAddress, {
			forceKillIncompatible: true,
			lockHeld: true,
		});
		startAddress = ensured.address;
		if (ensured.action === "reuse") {
			reusedExisting = true;
			existingServerId = (await getRpcServerHealth(startAddress))?.serverId;
			return;
		}

		startedAction = ensured.action;
		process.env.CLINE_RPC_ADDRESS = startAddress;
		handle = await startRpcServer({
			address: startAddress,
			sessionBackend: createSqliteRpcSessionBackend(),
			runtimeHandlers: createRpcRuntimeHandlers(),
		});
	});
	if (reusedExisting) {
		startupLogger.info?.("RPC server activation reused existing instance", {
			address: startAddress,
			serverId: existingServerId,
			action: "reuse",
		});
		writeln(
			`${c.dim}[rpc] already running server_id=${existingServerId ?? "unknown"} address=${startAddress}${c.reset}`,
		);
		return 0;
	}
	if (!handle) {
		writeErr(`failed to start rpc server at ${startAddress}`);
		return 1;
	}
	startupLogger.info?.("RPC server activation started", {
		address: handle.address,
		serverId: handle.serverId,
		requestedAddress: normalizedAddress,
		action: startedAction,
	});
	writeln(
		`${c.dim}[rpc] started server_id=${handle.serverId} address=${handle.address}${c.reset}`,
	);
	writeln(`${c.dim}[rpc] press Ctrl+C to stop${c.reset}`);

	await new Promise<void>((resolve) => {
		const shutdown = () => {
			process.off("SIGINT", shutdown);
			process.off("SIGTERM", shutdown);
			resolve();
		};
		process.on("SIGINT", shutdown);
		process.on("SIGTERM", shutdown);
	});

	await stopRpcServer();
	startupLogger.info?.("RPC server stopped", {
		address: handle.address,
		serverId: handle.serverId,
	});
	writeln(`${c.dim}[rpc] stopped${c.reset}`);
	return 0;
}

async function runRpcStatusCommand(
	options: { address: string; json?: boolean },
	writeln: (text?: string) => void,
	writeErr: (text: string) => void,
): Promise<number> {
	const normalizedAddress = options.address;
	if (!normalizedAddress) {
		writeErr("rpc status requires a non-empty address");
		return 1;
	}
	const jsonOutput = !!options.json;

	const health = await getRpcServerHealth(normalizedAddress);
	if (!health?.running) {
		if (jsonOutput) {
			writeln(
				JSON.stringify({
					running: false,
					address: normalizedAddress,
				}),
			);
		} else {
			writeln(
				`${c.dim}[rpc] not running address=${normalizedAddress}${c.reset}`,
			);
		}
		return 1;
	}

	const uptime = health.startedAt ? formatUptime(health.startedAt) : "unknown";

	if (jsonOutput) {
		writeln(
			JSON.stringify({
				running: true,
				serverId: health.serverId,
				address: health.address,
				startedAt: health.startedAt || null,
				uptime,
			}),
		);
	} else {
		writeln(
			`${c.dim}[rpc] running server_id=${health.serverId} address=${health.address} uptime=${uptime}${c.reset}`,
		);
	}
	return 0;
}

async function runRpcStopCommand(
	options: { address: string },
	writeln: (text?: string) => void,
	writeErr: (text: string) => void,
): Promise<number> {
	const normalizedAddress = options.address;
	if (!normalizedAddress) {
		writeErr("rpc stop requires a non-empty address");
		return 1;
	}

	const health = await getRpcServerHealth(normalizedAddress);
	if (!health?.running) {
		writeln(`${c.dim}[rpc] not running address=${normalizedAddress}${c.reset}`);
		return 0;
	}

	const shutdown = await requestRpcServerShutdown(normalizedAddress);
	if (!shutdown?.accepted) {
		writeErr(
			`failed to request rpc shutdown at ${normalizedAddress} (server may have exited)`,
		);
		return 1;
	}

	// Wait briefly for the server to unbind so follow-up calls can trust the result.
	for (let attempt = 0; attempt < 10; attempt += 1) {
		const nextHealth = await getRpcServerHealth(normalizedAddress);
		if (!nextHealth?.running) {
			writeln(
				`${c.dim}[rpc] stopped server_id=${health.serverId} address=${health.address}${c.reset}`,
			);
			return 0;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	writeErr(
		`rpc shutdown requested but server still reports healthy at ${health.address}`,
	);
	return 1;
}

async function runRpcRegisterCommand(
	options: {
		address: string;
		clientType: string;
		clientId?: string;
		meta: string[];
	},
	writeln: (text?: string) => void,
	writeErr: (text: string) => void,
): Promise<number> {
	const registerLogger = createCliLoggerAdapter({
		runtime: "cli",
		component: "rpc-register",
	}).core;
	const normalizedAddress = options.address;
	if (!normalizedAddress) {
		writeErr("rpc register requires a non-empty address");
		registerLogger.error?.("RPC client registration rejected: empty address");
		return 1;
	}

	const clientType = options.clientType;
	const requestedClientId = options.clientId;
	const metadata = parseMetaEntries(options.meta);

	const registration = await registerRpcClient(normalizedAddress, {
		clientId: requestedClientId,
		clientType,
		metadata,
	});
	if (!registration?.registered) {
		registerLogger.error?.("RPC client registration failed", {
			address: normalizedAddress,
			clientType,
			requestedClientId: requestedClientId ?? "",
			metadata,
		});
		writeErr(
			`failed to register client with rpc server at ${normalizedAddress}`,
		);
		return 1;
	}
	registerLogger.info?.("RPC client registered", {
		address: normalizedAddress,
		clientType,
		clientId: registration.clientId,
		requestedClientId: requestedClientId ?? "",
		metadata,
	});

	writeln(
		`${c.dim}[rpc] registered client_id=${registration.clientId} address=${normalizedAddress}${c.reset}`,
	);
	return 0;
}

// ---------------------------------------------------------------------------
// Commander command tree
// ---------------------------------------------------------------------------

export function createRpcCommand(
	io: RpcCommandIo,
	setExitCode: (code: number) => void,
): Command {
	const rpc = new Command("rpc")
		.description("Manage the local RPC runtime server")
		.exitOverride()
		.allowExcessArguments()
		.argument("[subcommand]");

	const addressOption = (description?: string) =>
		`--address <host:port>${description ? ` ${description}` : ""}`;

	rpc
		.command("ensure")
		.description("Ensure the RPC runtime is running")
		.option(
			addressOption(),
			"RPC server address",
			process.env.CLINE_RPC_ADDRESS || DEFAULT_RPC_ADDRESS,
		)
		.option("--json", "Output as JSON")
		.action(async function (this: Command) {
			const opts = this.opts<{ address: string; json?: boolean }>();
			setExitCode(
				await runRpcEnsureCommand(
					{ address: opts.address, json: opts.json },
					io.writeln,
					io.writeErr,
				),
			);
		});

	rpc
		.command("register")
		.description("Register an RPC client")
		.option(
			addressOption(),
			"RPC server address",
			process.env.CLINE_RPC_ADDRESS || DEFAULT_RPC_ADDRESS,
		)
		.option("--client-id <id>", "Client ID")
		.option("--client-type <type>", "Client type", "desktop")
		.option(
			"--meta <key=value>",
			"Metadata entry (repeatable)",
			collectMeta,
			[],
		)
		.action(async function (this: Command) {
			const opts = this.opts<{
				address: string;
				clientId?: string;
				clientType: string;
				meta: string[];
			}>();
			setExitCode(
				await runRpcRegisterCommand(
					{
						address: opts.address,
						clientType: opts.clientType,
						clientId: opts.clientId,
						meta: opts.meta,
					},
					io.writeln,
					io.writeErr,
				),
			);
		});

	rpc
		.command("start")
		.description("Start the RPC server")
		.option(
			addressOption(),
			"RPC server address",
			process.env.CLINE_RPC_ADDRESS || DEFAULT_RPC_ADDRESS,
		)
		.action(async function (this: Command) {
			const opts = this.opts<{ address: string }>();
			setExitCode(
				await runRpcStartCommand(
					{ address: opts.address },
					io.writeln,
					io.writeErr,
				),
			);
		});

	rpc
		.command("status")
		.description("Show RPC server status")
		.option(
			addressOption(),
			"RPC server address",
			process.env.CLINE_RPC_ADDRESS || DEFAULT_RPC_ADDRESS,
		)
		.option("--json", "Output as JSON")
		.action(async function (this: Command) {
			const opts = this.opts<{ address: string; json?: boolean }>();
			setExitCode(
				await runRpcStatusCommand(
					{ address: opts.address, json: opts.json },
					io.writeln,
					io.writeErr,
				),
			);
		});

	rpc
		.command("stop")
		.description("Stop the RPC server")
		.option(
			addressOption(),
			"RPC server address",
			process.env.CLINE_RPC_ADDRESS || DEFAULT_RPC_ADDRESS,
		)
		.action(async function (this: Command) {
			const opts = this.opts<{ address: string }>();
			setExitCode(
				await runRpcStopCommand(
					{ address: opts.address },
					io.writeln,
					io.writeErr,
				),
			);
		});

	rpc.action((subcommand?: string) => {
		if (subcommand) {
			io.writeErr(`unknown rpc subcommand "${subcommand}"`);
			setExitCode(1);
		}
	});

	return rpc;
}
