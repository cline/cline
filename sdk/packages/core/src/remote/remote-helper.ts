import { homedir } from "node:os";
import { claimHubDaemonProcess } from "@cline/shared";
import { setHomeDirIfUnset } from "@cline/shared/storage";
import { requestHubShutdown } from "../hub/client";
import { ensureDetachedHubServer } from "../hub/daemon";
import { clearHubDiscoveryIfOwned, readHubDiscovery } from "../hub/discovery";
import { ensureLoginShellPath } from "./shell-path";

export type RemoteHelperDependencies = {
	readHubDiscovery: typeof readHubDiscovery;
	clearHubDiscoveryIfOwned: typeof clearHubDiscoveryIfOwned;
	probeProcess: (pid: number) => void;
	requestHubShutdown: typeof requestHubShutdown;
	ensureDetachedHubServer: typeof ensureDetachedHubServer;
	claimHubDaemonProcess: typeof claimHubDaemonProcess;
	loadHubDaemon: () => Promise<unknown>;
	ensureLoginShellPath: typeof ensureLoginShellPath;
	setHomeDirIfUnset: typeof setHomeDirIfUnset;
	homeDir: () => string;
	cwd: () => string;
	env: NodeJS.ProcessEnv;
	writeOutput: (output: string) => void;
};

const defaultDependencies: RemoteHelperDependencies = {
	readHubDiscovery,
	clearHubDiscoveryIfOwned,
	probeProcess: (pid) => {
		process.kill(pid, 0);
	},
	requestHubShutdown,
	ensureDetachedHubServer,
	claimHubDaemonProcess,
	loadHubDaemon: () => import("@cline/core/hub/daemon-entry"),
	ensureLoginShellPath,
	setHomeDirIfUnset,
	homeDir: homedir,
	cwd: () => process.cwd(),
	env: process.env,
	writeOutput: (output) => process.stdout.write(output),
};

function readArgument(argv: string[], name: string): string | undefined {
	const index = argv.indexOf(name);
	const value = index >= 0 ? argv[index + 1] : undefined;
	return value?.trim() || undefined;
}

function configureDedicatedDiscovery(
	argv: string[],
	dependencies: RemoteHelperDependencies,
): string {
	const discoveryPath = readArgument(argv, "--discovery-path");
	if (!discoveryPath) {
		throw new Error("--discovery-path is required for remote Hub management");
	}
	// This explicit owner record is the safety boundary: the remote helper never
	// reads or shuts down the user's default CLI-owned Hub discovery record.
	dependencies.env.CLINE_HUB_DISCOVERY_PATH = discoveryPath;
	return discoveryPath;
}

export async function runRemoteHubEnsure(
	argv = process.argv,
	dependencies: RemoteHelperDependencies = defaultDependencies,
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
			...result,
			cwd,
			platform: process.platform,
			arch: process.arch,
		})}\n`,
	);
}

/**
 * Handles the SSH bootstrap command and the detached-daemon sentinel. The
 * standalone helper is compiled for the target host and contains no client UI
 * server or command router. Client executables may also use this entrypoint
 * to support the daemon sentinel.
 */
export async function runRemoteHelperEntrypoint(
	argv = process.argv,
	dependencies: RemoteHelperDependencies = defaultDependencies,
): Promise<boolean> {
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
	// Claim rather than read: consuming the sentinel keeps daemon-hosted
	// sessions from handing it to every process they spawn.
	if (dependencies.claimHubDaemonProcess()) {
		await dependencies.loadHubDaemon();
		return true;
	}
	return false;
}
