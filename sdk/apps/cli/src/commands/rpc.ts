import {
	clearRpcDiscoveryIfAddressMatches,
	createSqliteRpcSessionBackend,
	type ResolveRpcRuntimeResult,
	type RpcOwnerContext,
	recordRpcDiscovery,
	resolveEnsuredRpcRuntime,
	withRpcStartupLock,
} from "@clinebot/core";
import {
	getRpcServerHealth,
	RPC_PROTOCOL_VERSION,
	registerRpcClient,
	requestRpcServerShutdown,
	startRpcServer,
	stopRpcServer,
} from "@clinebot/rpc";
import { CLINE_DEFAULT_RPC_ADDRESS } from "@clinebot/shared";
import { Command } from "commander";
import { createCliLoggerAdapter } from "../logging/adapter";
import {
	ensureCliRpcRuntime,
	ensureCliRpcRuntimeAddress,
	resolveCurrentCliRpcOwnerContext,
} from "../utils/rpc-runtime";
import { createRpcRuntimeHandlers } from "./rpc-runtime";

const c = {
	dim: "\x1b[2m",
	reset: "\x1b[0m",
};

interface RpcCommandIo {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
}

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function collectMeta(value: string, previous: string[]): string[] {
	return previous.concat(value);
}

function parseMetaEntries(entries: string[]): Record<string, string> {
	const metadata: Record<string, string> = {};
	for (const raw of entries) {
		const sep = raw.indexOf("=");
		if (sep <= 0 || sep >= raw.length - 1) continue;
		const key = raw.slice(0, sep).trim();
		const value = raw.slice(sep + 1).trim();
		if (key && value) metadata[key] = value;
	}
	return metadata;
}

function resolveCurrentRpcOwnerContext(): RpcOwnerContext {
	return resolveCurrentCliRpcOwnerContext();
}

export async function ensureRpcRuntimeAddress(
	requestedAddress: string,
): Promise<string> {
	return ensureCliRpcRuntimeAddress(requestedAddress);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatUptime(startedAt: string): string {
	const startMs = new Date(startedAt).getTime();
	if (!Number.isFinite(startMs)) return "unknown";
	let seconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
	const days = Math.floor(seconds / 86400);
	seconds %= 86400;
	const hours = Math.floor(seconds / 3600);
	seconds %= 3600;
	const minutes = Math.floor(seconds / 60);
	seconds %= 60;
	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	parts.push(`${seconds}s`);
	return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

export async function runRpcEnsureCommand(
	options: { address: string; json?: boolean },
	writeln: (text?: string) => void,
	writeErr: (text: string) => void,
): Promise<number> {
	const { address: requestedAddress, json: jsonOutput } = options;
	let ensured: ResolveRpcRuntimeResult | undefined;
	try {
		ensured = await ensureCliRpcRuntime(requestedAddress);
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
	const rpcLogger = createCliLoggerAdapter({
		runtime: "cli",
		component: "rpc",
	}).core;
	const normalizedAddress = options.address;
	if (!normalizedAddress) {
		writeErr("rpc start requires a non-empty address");
		rpcLogger.error?.("RPC start rejected: empty address");
		return 1;
	}

	let startAddress = normalizedAddress;
	let handle: Awaited<ReturnType<typeof startRpcServer>> | undefined;
	let reusedExisting = false;
	let existingServerId: string | undefined;
	const owner = resolveCurrentRpcOwnerContext();
	let startedAction: "new-port" | "started" = "started";

	await withRpcStartupLock(normalizedAddress, async () => {
		const ensured = await resolveEnsuredRpcRuntime(normalizedAddress, {
			owner,
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
			scheduler: {
				logger: rpcLogger,
			},
		});
		await recordRpcDiscovery(owner, {
			address: startAddress,
			pid: process.pid,
			serverId: handle.serverId,
			startedAt: handle.startedAt,
			protocolVersion: RPC_PROTOCOL_VERSION,
			entryPath: owner.entryPath,
		});
	});

	if (reusedExisting) {
		const health = await getRpcServerHealth(startAddress);
		await recordRpcDiscovery(owner, {
			address: startAddress,
			pid: undefined,
			serverId: health?.serverId,
			startedAt: health?.startedAt,
			protocolVersion: RPC_PROTOCOL_VERSION,
			entryPath: owner.entryPath,
		});
		rpcLogger.log("RPC server activation reused existing instance", {
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
	rpcLogger.log("RPC server activation started", {
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
	await clearRpcDiscoveryIfAddressMatches(owner, handle.address);
	rpcLogger.log("RPC server stopped", {
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

	const health = await getRpcServerHealth(normalizedAddress);
	if (!health?.running) {
		if (options.json) {
			writeln(JSON.stringify({ running: false, address: normalizedAddress }));
		} else {
			writeln(
				`${c.dim}[rpc] not running address=${normalizedAddress}${c.reset}`,
			);
		}
		return 1;
	}

	const uptime = health.startedAt ? formatUptime(health.startedAt) : "unknown";
	if (options.json) {
		writeln(
			JSON.stringify({
				running: true,
				serverId: health.serverId,
				address: health.address,
				startedAt: health.startedAt || null,
				uptime,
				rpcVersion: health.rpcVersion || null,
			}),
		);
	} else {
		const version = health.rpcVersion ? ` version=${health.rpcVersion}` : "";
		writeln(
			`${c.dim}[rpc] running server_id=${health.serverId} address=${health.address}${version} uptime=${uptime}${c.reset}`,
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
	const owner = resolveCurrentRpcOwnerContext();
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

	for (let i = 0; i < 10; i++) {
		if (!(await getRpcServerHealth(normalizedAddress))?.running) {
			await clearRpcDiscoveryIfAddressMatches(owner, normalizedAddress);
			writeln(
				`${c.dim}[rpc] stopped server_id=${health.serverId} address=${health.address}${c.reset}`,
			);
			return 0;
		}
		await sleep(100);
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

	const metadata = parseMetaEntries(options.meta);
	const registration = await registerRpcClient(normalizedAddress, {
		clientId: options.clientId,
		clientType: options.clientType,
		metadata,
	});
	if (!registration?.registered) {
		registerLogger.error?.("RPC client registration failed", {
			address: normalizedAddress,
			clientType: options.clientType,
			requestedClientId: options.clientId ?? "",
			metadata,
		});
		writeErr(
			`failed to register client with rpc server at ${normalizedAddress}`,
		);
		return 1;
	}
	registerLogger.log("RPC client registered", {
		address: normalizedAddress,
		clientType: options.clientType,
		clientId: registration.clientId,
		requestedClientId: options.clientId ?? "",
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

const DEFAULT_RPC_ADDRESS =
	process.env.CLINE_RPC_ADDRESS || CLINE_DEFAULT_RPC_ADDRESS;

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
		.option(addressOption(), "RPC server address", DEFAULT_RPC_ADDRESS)
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
		.option(addressOption(), "RPC server address", DEFAULT_RPC_ADDRESS)
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
		.option(addressOption(), "RPC server address", DEFAULT_RPC_ADDRESS)
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
		.option(addressOption(), "RPC server address", DEFAULT_RPC_ADDRESS)
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
		.option(addressOption(), "RPC server address", DEFAULT_RPC_ADDRESS)
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
