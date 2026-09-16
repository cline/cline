import { homedir } from "node:os";
import { ensureDetachedHubServer, setHomeDirIfUnset } from "@cline/core";
import { claimHubDaemonProcess } from "@cline/shared";
import { ensureLoginShellPath } from "./shell-path";

export type RemoteHelperDependencies = {
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
 * full desktop sidecar imports this function for same-platform remote hosts;
 * packaged Linux SSH helpers compile this file directly and contain no desktop
 * HTTP/WebSocket server or UI command router.
 */
export async function runRemoteHelperEntrypoint(
	argv = process.argv,
	dependencies: RemoteHelperDependencies = defaultDependencies,
): Promise<boolean> {
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

if (import.meta.main) {
	void (async () => {
		if (!(await runRemoteHelperEntrypoint())) {
			throw new Error("A remote helper command is required");
		}
	})().catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`${message}\n`);
		process.exitCode = 1;
	});
}
