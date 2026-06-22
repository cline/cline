import { spawn } from "node:child_process";
import { CLINE_RUN_AS_HUB_DAEMON_ENV } from "@cline/shared";
import {
	clearHubDashboardDiscovery,
	isHubDashboardPidAlive,
	readHubDashboardDiscovery,
} from "../dashboard-discovery";

const DASHBOARD_LAUNCHER_ENV = "CLINE_HUB_DASHBOARD_LAUNCHER";
const DASHBOARD_ARGS_ENV = "CLINE_HUB_DASHBOARD_ARGS";
const DASHBOARD_STOP_TIMEOUT_MS = 3_000;
const DASHBOARD_STOP_POLL_MS = 100;

async function waitForPidToExit(pid: number): Promise<boolean> {
	const deadline = Date.now() + DASHBOARD_STOP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (!isHubDashboardPidAlive(pid)) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, DASHBOARD_STOP_POLL_MS));
	}
	return false;
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
	try {
		process.kill(discovered.pid, "SIGTERM");
	} catch {
		await clearHubDashboardDiscovery(discoveryPath).catch(() => undefined);
		return false;
	}
	const stopped = await waitForPidToExit(discovered.pid);
	await clearHubDashboardDiscovery(discoveryPath).catch(() => undefined);
	return stopped;
}

export async function restartManagedHubDashboardProcess(options: {
	discoveryPath: string;
	cwd: string;
	env?: NodeJS.ProcessEnv;
}): Promise<void> {
	const env = options.env ?? process.env;
	const launcher = env[DASHBOARD_LAUNCHER_ENV]?.trim();
	const args = parseDashboardArgs(env);
	if (!launcher || !args) {
		return;
	}
	await stopManagedHubDashboardProcess(options.discoveryPath).catch(
		() => undefined,
	);
	const childEnv: NodeJS.ProcessEnv = {
		...env,
		CLINE_HUB_DASHBOARD_DISCOVERY_PATH: options.discoveryPath,
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
