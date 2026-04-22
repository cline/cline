import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	resolveClineDataDir,
	resolveSharedHubOwnerContext,
} from "@clinebot/core";
import {
	type HubEndpointOverrides,
	probeHubServer,
	readHubDiscovery,
} from "@clinebot/hub";
import { withResolvedClineBuildEnv } from "@clinebot/shared";
import { createCliLoggerAdapter } from "../logging/adapter";
import { buildCliSubcommandCommand } from "./internal-launch";

function getHubCommandLogger() {
	return createCliLoggerAdapter({
		runtime: "cli",
		component: "hub",
	}).core;
}

function openDetachedHubLogFile(): { fd: number; logPath: string } | undefined {
	try {
		const logPath = join(resolveClineDataDir(), "logs", "hub-sidecar.log");
		mkdirSync(dirname(logPath), { recursive: true });
		return { fd: openSync(logPath, "a"), logPath };
	} catch {
		return undefined;
	}
}

function endpointArgs(endpoint: HubEndpointOverrides): string[] {
	return [
		...(endpoint.host ? ["--host", endpoint.host] : []),
		...(typeof endpoint.port === "number"
			? ["--port", String(endpoint.port)]
			: []),
		...(endpoint.pathname ? ["--pathname", endpoint.pathname] : []),
	];
}

export function parseHubEndpointOverride(
	rawAddress: string | undefined,
): HubEndpointOverrides {
	const trimmed = rawAddress?.trim();
	if (!trimmed) {
		return {};
	}
	try {
		const parsed = new URL(
			trimmed.includes("://") ? trimmed : `ws://${trimmed}`,
		);
		return {
			host: parsed.hostname || undefined,
			port: parsed.port ? Number(parsed.port) : undefined,
			pathname:
				parsed.pathname && parsed.pathname !== "/"
					? parsed.pathname
					: undefined,
		};
	} catch {
		return {};
	}
}

export function spawnCliHubStartDetached(
	workspaceRoot: string,
	endpoint: HubEndpointOverrides,
): void {
	const logger = getHubCommandLogger();
	const command = buildCliSubcommandCommand("hub", [
		"start",
		"--cwd",
		workspaceRoot,
		...endpointArgs(endpoint),
	]);
	if (!command) {
		throw new Error("unable to resolve CLI entrypoint for detached hub start");
	}

	const sidecarLog = openDetachedHubLogFile();
	try {
		const child = spawn(command.launcher, command.childArgs, {
			detached: true,
			stdio: sidecarLog ? ["ignore", sidecarLog.fd, sidecarLog.fd] : "ignore",
			env: {
				...withResolvedClineBuildEnv(process.env),
				CLINE_NO_INTERACTIVE: "1",
			},
			cwd: process.cwd(),
		});
		logger.log("Detached hub daemon spawned", {
			childPid: child.pid,
			logPath: sidecarLog?.logPath,
			workspaceRoot,
			endpoint,
		});
		child.unref();
	} finally {
		if (sidecarLog) {
			closeSync(sidecarLog.fd);
		}
	}
}

function readHubDiscoverySync(): { pid?: number } | undefined {
	const owner = resolveSharedHubOwnerContext();
	try {
		const parsed = JSON.parse(readFileSync(owner.discoveryPath, "utf8")) as {
			pid?: unknown;
		};
		return typeof parsed.pid === "number" ? { pid: parsed.pid } : {};
	} catch {
		return undefined;
	}
}

function isPidAlive(pid: number | undefined): boolean {
	if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function prewarmCliHubServer(
	workspaceRoot: string,
	endpoint: HubEndpointOverrides = {},
): void {
	const discovery = readHubDiscoverySync();
	if (isPidAlive(discovery?.pid)) {
		return;
	}
	try {
		spawnCliHubStartDetached(workspaceRoot, endpoint);
	} catch {
		// Best-effort background prewarm only.
	}
}

export async function ensureCliHubServer(
	workspaceRoot: string,
	endpoint: HubEndpointOverrides = {},
): Promise<string> {
	const owner = resolveSharedHubOwnerContext();
	const discovered = await readHubDiscovery(owner.discoveryPath);
	if (discovered?.url) {
		const healthy = await probeHubServer(discovered.url);
		if (healthy?.url) {
			return healthy.url;
		}
	}

	spawnCliHubStartDetached(workspaceRoot, endpoint);
	const deadline = Date.now() + 8_000;
	while (Date.now() < deadline) {
		const nextDiscovery = await readHubDiscovery(owner.discoveryPath);
		if (nextDiscovery?.url) {
			const healthy = await probeHubServer(nextDiscovery.url);
			if (healthy?.url) {
				return healthy.url;
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error("Timed out waiting for background hub startup.");
}
