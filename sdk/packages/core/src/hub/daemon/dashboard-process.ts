import { spawn } from "node:child_process";
import { CLINE_RUN_AS_HUB_DAEMON_ENV } from "@cline/shared";
import {
	CLINE_HUB_DASHBOARD_DISCOVERY_PATH_ENV,
	clearHubDashboardDiscovery,
	isHubDashboardPidAlive,
	readHubDashboardDiscovery,
} from "../dashboard-discovery";

const DASHBOARD_LAUNCHER_ENV = "CLINE_HUB_DASHBOARD_LAUNCHER";
const DASHBOARD_ARGS_ENV = "CLINE_HUB_DASHBOARD_ARGS";
const DASHBOARD_STOP_TIMEOUT_MS = 3_000;
const DASHBOARD_STOP_POLL_MS = 100;

/**
 * Set on a replacement hub daemon when the dashboard initiating the restart
 * must remain alive and attached to the new daemon.
 */
export const CLINE_HUB_PRESERVE_DASHBOARD_ENV = "CLINE_HUB_PRESERVE_DASHBOARD";

async function waitForPidToExit(pid: number): Promise<boolean> {
	const deadline = Date.now() + DASHBOARD_STOP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (!isHubDashboardPidAlive(pid)) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, DASHBOARD_STOP_POLL_MS));
	}
	return !isHubDashboardPidAlive(pid);
}

/** Clear discovery only when it still refers to the pid we stopped. */
async function clearHubDashboardDiscoveryIfOwned(
	discoveryPath: string,
	pid: number,
): Promise<void> {
	const current = await readHubDashboardDiscovery(discoveryPath);
	if (current?.pid !== undefined && current.pid !== pid) {
		return;
	}
	await clearHubDashboardDiscovery(discoveryPath).catch(() => undefined);
}

function parseDashboardArgs(env: NodeJS.ProcessEnv): string[] | undefined {
	const raw = env[DASHBOARD_ARGS_ENV]?.trim();
	if (!raw) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			return undefined;
		}
		const args = parsed.filter((value): value is string => {
			return typeof value === "string";
		});
		return args.length > 0 ? args : undefined;
	} catch {
		return undefined;
	}
}

export async function stopManagedHubDashboardProcess(
	discoveryPath: string,
): Promise<boolean> {
	const discovered = await readHubDashboardDiscovery(discoveryPath);
	if (!discovered?.pid) {
		await clearHubDashboardDiscovery(discoveryPath).catch(() => undefined);
		return false;
	}
	const stoppedPid = discovered.pid;
	try {
		process.kill(stoppedPid, "SIGTERM");
	} catch (error) {
		if (isHubDashboardPidAlive(stoppedPid)) {
			throw error;
		}
		await clearHubDashboardDiscoveryIfOwned(discoveryPath, stoppedPid);
		return false;
	}
	const stopped = await waitForPidToExit(stoppedPid);
	if (!stopped) {
		throw new Error(
			`Timed out waiting for dashboard process ${stoppedPid} to stop.`,
		);
	}
	await clearHubDashboardDiscoveryIfOwned(discoveryPath, stoppedPid);
	return true;
}

export async function restartManagedHubDashboardProcess(options: {
	discoveryPath: string;
	cwd: string;
	env?: NodeJS.ProcessEnv;
}): Promise<void> {
	const env = options.env ?? process.env;
	if (env[CLINE_HUB_PRESERVE_DASHBOARD_ENV]?.trim() === "1") {
		return;
	}
	const launcher = env[DASHBOARD_LAUNCHER_ENV]?.trim();
	const args = parseDashboardArgs(env);
	if (!launcher || !args) {
		return;
	}
	await stopManagedHubDashboardProcess(options.discoveryPath);
	const childEnv: NodeJS.ProcessEnv = {
		...env,
		[CLINE_HUB_DASHBOARD_DISCOVERY_PATH_ENV]: options.discoveryPath,
		CLINE_NO_INTERACTIVE: "1",
	};
	delete childEnv[CLINE_RUN_AS_HUB_DAEMON_ENV];
	const child = spawn(launcher, args, {
		cwd: options.cwd,
		detached: true,
		stdio: "ignore",
		env: childEnv,
		windowsHide: true,
	});
	child.unref();
}
