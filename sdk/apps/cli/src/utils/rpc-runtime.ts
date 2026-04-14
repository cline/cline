import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	ensureRpcRuntimeAddress as ensureSharedRpcRuntimeAddress,
	type ResolveRpcRuntimeResult,
	RPC_BUILD_ID_ENV,
	RPC_DISCOVERY_PATH_ENV,
	RPC_OWNER_ID_ENV,
	RPC_STARTUP_LOCK_BYPASS_ENV,
	type RpcOwnerContext,
	resolveClineDataDir,
	resolveRpcOwnerContext,
	tryAcquireRpcSpawnLease,
} from "@clinebot/core";
import { withResolvedClineBuildEnv } from "@clinebot/shared";
import { createCliLoggerAdapter } from "../logging/adapter";
import { logSpawnedProcess } from "../logging/process";
import {
	buildCliSubcommandCommand,
	resolveCliLaunchSpec,
} from "./internal-launch";

function resolveRpcEntrypoint(): string | undefined {
	return resolveCliLaunchSpec()?.identityPath;
}

export function resolveCurrentCliRpcOwnerContext(): RpcOwnerContext {
	return resolveRpcOwnerContext({
		discoveryPath: process.env[RPC_DISCOVERY_PATH_ENV]?.trim(),
		identityPath: resolveRpcEntrypoint(),
		ownerId: process.env[RPC_OWNER_ID_ENV]?.trim(),
		ownerPrefix: "cli",
	});
}

function getRpcCommandLogger() {
	return createCliLoggerAdapter({
		runtime: "cli",
		component: "rpc",
	}).core;
}

function openDetachedRpcLogFile(): { fd: number; logPath: string } | undefined {
	try {
		const logPath = join(resolveClineDataDir(), "logs", "rpc-sidecar.log");
		mkdirSync(dirname(logPath), { recursive: true });
		return { fd: openSync(logPath, "a"), logPath };
	} catch {
		return undefined;
	}
}

export function spawnCliRpcStartDetached(
	address: string,
	owner: RpcOwnerContext,
): void {
	const logger = getRpcCommandLogger();
	const lease = tryAcquireRpcSpawnLease(address);
	if (!lease) {
		logger.log("RPC sidecar spawn skipped", {
			address,
			reason: "spawn_lease_unavailable",
			severity: "warn",
		});
		return;
	}

	const command = buildCliSubcommandCommand("rpc", [
		"start",
		"--address",
		address,
	]);
	if (!command) {
		lease.release();
		logger.error?.("RPC sidecar spawn aborted", {
			address,
			reason: "unable_to_resolve_cli_entrypoint",
		});
		throw new Error("unable to resolve CLI entrypoint for detached rpc start");
	}

	const sidecarLog = openDetachedRpcLogFile();
	logger.log("Launching detached RPC sidecar", {
		address,
		command: [command.launcher, ...command.childArgs].join(" "),
		commandArgs: command.childArgs,
		executable: command.launcher,
		cwd: process.cwd(),
		logPath: sidecarLog?.logPath,
		ownerId: owner.ownerId,
		buildId: owner.buildId,
	});
	try {
		const child = spawn(command.launcher, command.childArgs, {
			detached: true,
			stdio: sidecarLog ? ["ignore", sidecarLog.fd, sidecarLog.fd] : "ignore",
			env: {
				...withResolvedClineBuildEnv(process.env),
				[RPC_STARTUP_LOCK_BYPASS_ENV]: "1",
				[RPC_OWNER_ID_ENV]: owner.ownerId,
				[RPC_BUILD_ID_ENV]: owner.buildId,
				[RPC_DISCOVERY_PATH_ENV]: owner.discoveryPath,
			},
			cwd: process.cwd(),
		});
		logSpawnedProcess({
			component: "rpc",
			command: [command.launcher, ...command.childArgs],
			childPid: child.pid ?? undefined,
			detached: true,
			cwd: process.cwd(),
			metadata: {
				rpcAddress: address,
				purpose: "rpc.start.background",
				logPath: sidecarLog?.logPath,
			},
		});
		logger.log("Detached RPC sidecar spawned", {
			address,
			childPid: child.pid,
			logPath: sidecarLog?.logPath,
		});
		child.unref();
		setTimeout(() => lease.release(), 10_000).unref();
	} catch (error) {
		lease.release();
		logger.error?.("RPC sidecar spawn failed", {
			address,
			logPath: sidecarLog?.logPath,
			error,
		});
		throw error;
	} finally {
		if (sidecarLog) {
			closeSync(sidecarLog.fd);
		}
	}
}

export async function ensureCliRpcRuntime(
	requestedAddress: string,
): Promise<ResolveRpcRuntimeResult> {
	return await ensureSharedRpcRuntimeAddress(requestedAddress, {
		resolveOwner: resolveCurrentCliRpcOwnerContext,
		spawnIfNeeded: (address, owner) => {
			spawnCliRpcStartDetached(address, owner);
		},
	});
}

export async function ensureCliRpcRuntimeAddress(
	requestedAddress: string,
): Promise<string> {
	return (await ensureCliRpcRuntime(requestedAddress)).address;
}
