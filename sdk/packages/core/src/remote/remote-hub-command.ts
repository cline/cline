import { homedir } from "node:os";
import { resolve } from "node:path";
import {
	CURRENT_HUB_PROTOCOL_VERSION,
	MAX_CLIENT_HUB_PROTOCOL_VERSION,
	MIN_CLIENT_HUB_PROTOCOL_VERSION,
} from "@cline/shared";
import { setHomeDirIfUnset } from "@cline/shared/storage";
import { requestHubShutdown } from "../hub/client";
import {
	ensureDetachedHubServer,
	resolveDefaultHubOwnerContext,
} from "../hub/daemon";
import {
	clearHubDiscoveryIfOwned,
	readHubDiscovery,
	resolveHubBuildIdentity,
} from "../hub/discovery";
import { ensureLoginShellPath } from "./shell-path";

export type RemoteHubCommandDependencies = {
	readHubDiscovery: typeof readHubDiscovery;
	clearHubDiscoveryIfOwned: typeof clearHubDiscoveryIfOwned;
	probeProcess: (pid: number) => void;
	requestHubShutdown: typeof requestHubShutdown;
	ensureDetachedHubServer: typeof ensureDetachedHubServer;
	resolveDefaultHubDiscoveryPath: () => string;
	ensureLoginShellPath: typeof ensureLoginShellPath;
	resolveHubBuildIdentity: typeof resolveHubBuildIdentity;
	setHomeDirIfUnset: typeof setHomeDirIfUnset;
	homeDir: () => string;
	cwd: () => string;
	env: NodeJS.ProcessEnv;
	writeOutput: (output: string) => void;
};

const defaultDependencies: RemoteHubCommandDependencies = {
	readHubDiscovery,
	clearHubDiscoveryIfOwned,
	probeProcess: (pid) => {
		process.kill(pid, 0);
	},
	requestHubShutdown,
	ensureDetachedHubServer,
	resolveDefaultHubDiscoveryPath: () =>
		resolveDefaultHubOwnerContext().discoveryPath,
	ensureLoginShellPath,
	resolveHubBuildIdentity,
	setHomeDirIfUnset,
	homeDir: homedir,
	cwd: () => process.cwd(),
	env: process.env,
	writeOutput: (output) => process.stdout.write(output),
};

/**
 * Bumped when the `--remote-hub-*` command contract changes (flags, output
 * shape), independently of the Hub wire protocol.
 */
export const REMOTE_HUB_COMMAND_VERSION = 1;

export const REMOTE_HUB_COMMAND_FLAGS = [
	"--remote-hub-info",
	"--remote-hub-ensure",
	"--remote-hub-stop",
] as const;

export interface RemoteHubInfo {
	remoteHubCommandVersion: number;
	protocolVersion: string;
	minClientProtocolVersion: string;
	maxClientProtocolVersion: string;
	coreVersion?: string;
	buildId?: string;
	buildEpochMs?: number;
	platform: NodeJS.Platform;
	arch: string;
}

function remoteHubInfo(
	dependencies: RemoteHubCommandDependencies,
): RemoteHubInfo {
	const identity = dependencies.resolveHubBuildIdentity();
	return {
		remoteHubCommandVersion: REMOTE_HUB_COMMAND_VERSION,
		protocolVersion: CURRENT_HUB_PROTOCOL_VERSION,
		minClientProtocolVersion: MIN_CLIENT_HUB_PROTOCOL_VERSION,
		maxClientProtocolVersion: MAX_CLIENT_HUB_PROTOCOL_VERSION,
		...identity,
		platform: process.platform,
		arch: process.arch,
	};
}

export function isRemoteHubCommand(argv = process.argv): boolean {
	return REMOTE_HUB_COMMAND_FLAGS.some((flag) => argv.includes(flag));
}

function readArgument(argv: string[], name: string): string | undefined {
	const index = argv.indexOf(name);
	const value = index >= 0 ? argv[index + 1] : undefined;
	return value?.trim() || undefined;
}

function configureDedicatedDiscovery(
	argv: string[],
	dependencies: RemoteHubCommandDependencies,
): string {
	const discoveryPath = readArgument(argv, "--discovery-path");
	if (!discoveryPath) {
		throw new Error("--discovery-path is required for remote Hub management");
	}
	const defaultDiscoveryPath = dependencies.resolveDefaultHubDiscoveryPath();
	const normalizeDiscoveryPath = (path: string) => {
		const resolved = resolve(path);
		return process.platform === "win32" ? resolved.toLowerCase() : resolved;
	};
	if (
		normalizeDiscoveryPath(discoveryPath) ===
		normalizeDiscoveryPath(defaultDiscoveryPath)
	) {
		throw new Error(
			"Remote Hub management cannot use the default CLI Hub discovery path",
		);
	}
	// This explicit owner record is the safety boundary: the remote command never
	// reads or shuts down the user's default CLI-owned Hub discovery record.
	dependencies.env.CLINE_HUB_DISCOVERY_PATH = discoveryPath;
	return discoveryPath;
}

export async function runRemoteHubEnsure(
	argv = process.argv,
	dependencies: RemoteHubCommandDependencies = defaultDependencies,
): Promise<void> {
	dependencies.setHomeDirIfUnset(dependencies.homeDir());
	await dependencies.ensureLoginShellPath();
	const cwd = readArgument(argv, "--cwd") ?? dependencies.cwd();
	configureDedicatedDiscovery(argv, dependencies);
	const result = await dependencies.ensureDetachedHubServer(cwd, {
		host: "127.0.0.1",
		port: 0,
		pathname: "/hub",
		allowPortFallback: true,
		manageConnectors: false,
	});
	dependencies.writeOutput(
		`${JSON.stringify({
			...remoteHubInfo(dependencies),
			...result,
			cwd,
		})}\n`,
	);
}

/**
 * Handles the `--remote-hub-*` SSH bootstrap commands. Returns false when
 * argv carries none of them. The installed @cline/server executable serves these commands
 * so desktop clients can bootstrap and clean up an owned Hub over SSH.
 */
export async function runRemoteHubCommand(
	argv = process.argv,
	dependencies: RemoteHubCommandDependencies = defaultDependencies,
): Promise<boolean> {
	if (argv.includes("--remote-hub-info")) {
		dependencies.writeOutput(
			`${JSON.stringify(remoteHubInfo(dependencies))}\n`,
		);
		return true;
	}
	if (argv.includes("--remote-hub-stop")) {
		const discoveryPath = configureDedicatedDiscovery(argv, dependencies);
		const hub = await dependencies.readHubDiscovery(discoveryPath);
		// A crash or reboot can leave discovery pointing at a dead Hub. Only
		// ESRCH proves the process is gone; permission/probe errors and live
		// processes must still go through authenticated shutdown.
		if (
			hub &&
			typeof hub.pid === "number" &&
			Number.isInteger(hub.pid) &&
			hub.pid > 0
		) {
			try {
				dependencies.probeProcess(hub.pid);
			} catch (error) {
				if ((error as NodeJS.ErrnoException)?.code === "ESRCH") {
					await dependencies.clearHubDiscoveryIfOwned(discoveryPath, hub.hubId);
					return true;
				}
			}
		}
		if (
			hub &&
			!(await dependencies.requestHubShutdown(hub.url, hub.authToken))
		) {
			throw new Error("Remote Hub shutdown failed");
		}
		return true;
	}
	if (argv.includes("--remote-hub-ensure")) {
		await runRemoteHubEnsure(argv, dependencies);
		return true;
	}
	return false;
}
