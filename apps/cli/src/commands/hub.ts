import {
	clearHubDiscovery,
	ensureDetachedHubServer,
	probeHubServer,
	readHubDiscovery,
	resolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext,
	stopLocalHubServerGracefully,
} from "@cline/core";
import { formatUptime, resolveClineBuildEnv } from "@cline/shared";
import { Command } from "commander";
import {
	restartQueuedConnectorsForHub,
	stopConnectorsForHubs,
} from "../connectors/restart";
import { resolveDefaultCliHubUrl } from "../utils/hub-runtime";

interface HubCommandIo {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
}

async function stopHubServer(
	_workspaceRoot: string,
	io: HubCommandIo,
): Promise<{
	stopped: boolean;
	stoppedConnectorProcesses: number;
	queuedConnectorRestarts: number;
}> {
	const owner = resolveCliHubOwnerContext();
	const discovery = await readHubDiscovery(owner.discoveryPath);
	const stoppedConnectors = discovery?.url
		? await stopConnectorsForHubs([discovery.url], io, {
				targetHubUrl: resolveDefaultCliHubUrl(),
			})
		: { stoppedProcesses: 0, queuedRestarts: 0 };
	if (await stopLocalHubServerGracefully(owner)) {
		await clearHubDiscovery(owner.discoveryPath);
		return {
			stopped: true,
			stoppedConnectorProcesses: stoppedConnectors.stoppedProcesses,
			queuedConnectorRestarts: stoppedConnectors.queuedRestarts,
		};
	}
	const pid = discovery?.pid;
	if (pid) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// best effort
		}
	}
	await clearHubDiscovery(owner.discoveryPath);
	return {
		stopped: !!pid,
		stoppedConnectorProcesses: stoppedConnectors.stoppedProcesses,
		queuedConnectorRestarts: stoppedConnectors.queuedRestarts,
	};
}

function formatHubUptimeFromStartedAt(
	startedAt: string | undefined,
): string | undefined {
	if (!startedAt) {
		return undefined;
	}
	const timestamp = Date.parse(startedAt);
	if (Number.isNaN(timestamp)) {
		return undefined;
	}
	return formatUptime(Date.now() - timestamp);
}

function resolveCliHubOwnerContext() {
	return resolveClineBuildEnv() === "production"
		? resolveProductionHubOwnerContext()
		: resolveSharedHubOwnerContext();
}

export function createHubCommand(
	io: HubCommandIo,
	setExitCode: (code: number) => void,
): Command {
	let actionExitCode = 0;
	const fail = () => {
		actionExitCode = 1;
	};
	const action =
		<T extends unknown[]>(fn: (...args: T) => Promise<void>) =>
		async (...args: T) => {
			try {
				await fn(...args);
			} catch (error) {
				io.writeErr(error instanceof Error ? error.message : String(error));
				fail();
			}
		};

	const hub = new Command("hub")
		.description("Manage the local hub daemon")
		.exitOverride()
		.hook("postAction", () => {
			setExitCode(actionExitCode);
		})
		.option("--cwd <path>", "Workspace root", process.cwd())
		.option("--host <host>", "Hub host")
		.option("--port <port>", "Hub port", (value) => Number.parseInt(value, 10))
		.option("--pathname <path>", "Hub websocket path");

	hub.command("ensure").action(
		action(async () => {
			const opts = hub.opts<{
				cwd: string;
				host?: string;
				port?: number;
				pathname?: string;
			}>();
			const { url } = await ensureDetachedHubServer(opts.cwd, {
				host: opts.host,
				port: opts.port,
				pathname: opts.pathname,
			});
			await restartQueuedConnectorsForHub(url, io);
			io.writeln(url);
		}),
	);

	hub.command("start").action(
		action(async () => {
			const opts = hub.opts<{
				cwd: string;
				host?: string;
				port?: number;
				pathname?: string;
			}>();
			const { url } = await ensureDetachedHubServer(opts.cwd, {
				host: opts.host,
				port: opts.port,
				pathname: opts.pathname,
			});
			await restartQueuedConnectorsForHub(url, io);
			io.writeln(url);
		}),
	);

	hub.command("status").action(
		action(async () => {
			const owner = resolveCliHubOwnerContext();
			const discovery = await readHubDiscovery(owner.discoveryPath);
			const health = discovery?.url
				? await probeHubServer(discovery.url, {
						authToken: discovery.authToken,
					})
				: undefined;
			const uptime = formatHubUptimeFromStartedAt(health?.startedAt);
			io.writeln(
				JSON.stringify({
					running: !!health?.url,
					url: health?.url,
					pid: health?.pid,
					startedAt: health?.startedAt,
					uptime,
				}),
			);
		}),
	);

	hub.command("stop").action(
		action(async () => {
			const opts = hub.opts<{ cwd: string }>();
			io.writeln(JSON.stringify(await stopHubServer(opts.cwd, io)));
		}),
	);

	return hub;
}
