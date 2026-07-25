import { AgentRuntimeAbortError } from "@cline/agents";
import { initVcr } from "@cline/shared";
import {
	CLINE_HUB_PRESERVE_DASHBOARD_ENV,
	restartManagedHubDashboardProcess,
	stopManagedHubDashboardProcess,
} from "../daemon/dashboard-process";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import {
	CLINE_HUB_DASHBOARD_DISCOVERY_PATH_ENV,
	resolveHubDashboardDiscoveryPath,
} from "../dashboard-discovery";
import { resolveHubEndpointOptions } from "../discovery/defaults";
import { resolveDefaultHubOwnerContext } from "../discovery/workspace";
import { startHubWebSocketServer } from "../server";
import { createHubDaemonTelemetry } from "./telemetry";

initVcr(process.env.CLINE_VCR);

function parseArgs(argv: string[]): {
	cwd: string;
	host?: string;
	port?: number;
	pathname?: string;
} {
	let cwd = process.cwd();
	let host: string | undefined;
	let port: number | undefined;
	let pathname: string | undefined;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const value = argv[index + 1];
		if (arg === "--cwd" && value) {
			cwd = value;
			index += 1;
			continue;
		}
		if (arg === "--host" && value) {
			host = value;
			index += 1;
			continue;
		}
		if (arg === "--port" && value) {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) {
				port = parsed;
			}
			index += 1;
			continue;
		}
		if (arg === "--pathname" && value) {
			pathname = value;
			index += 1;
		}
	}

	return { cwd, host, port, pathname };
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	process.chdir(options.cwd);

	const endpoint = resolveHubEndpointOptions({
		host: options.host,
		port: options.port,
		pathname: options.pathname,
	});

	const owner = resolveDefaultHubOwnerContext();
	const dashboardDiscoveryPath =
		process.env[CLINE_HUB_DASHBOARD_DISCOVERY_PATH_ENV]?.trim() ||
		resolveHubDashboardDiscoveryPath(owner);

	const daemonTelemetry = createHubDaemonTelemetry();

	let server: Awaited<ReturnType<typeof startHubWebSocketServer>>;
	try {
		server = await startHubWebSocketServer({
			host: endpoint.host,
			port: endpoint.port,
			pathname: endpoint.pathname,
			owner,
			telemetry: daemonTelemetry.telemetry,
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers({
				telemetry: daemonTelemetry.telemetry,
			}),
			cronOptions: { workspaceRoot: options.cwd },
		});
	} catch (error) {
		// Flush before the top-level catch exits so failed daemon starts are
		// still visible in telemetry instead of dying silently.
		await daemonTelemetry.dispose().catch(() => undefined);
		throw error;
	}

	const preserveDashboardDuringStartup =
		process.env[CLINE_HUB_PRESERVE_DASHBOARD_ENV]?.trim() === "1";
	let dashboardStartupSettled = false;
	let preserveDashboardOnShutdown = false;
	let dashboardRestartPromise = Promise.resolve();
	const rememberPreserveDashboard = (preserve: boolean): void => {
		if (
			preserve ||
			(!dashboardStartupSettled && preserveDashboardDuringStartup)
		) {
			preserveDashboardOnShutdown = true;
		}
	};

	const shutdownRequestPromise = server.shutdownRequested.then((request) => {
		rememberPreserveDashboard(request.preserveDashboard);
		return request;
	});

	let shutdownStarted = false;
	const shutdown = async (
		options: { preserveDashboard?: boolean } = {},
	): Promise<void> => {
		rememberPreserveDashboard(options.preserveDashboard === true);
		if (shutdownStarted) {
			return;
		}
		shutdownStarted = true;
		await dashboardRestartPromise;
		if (!preserveDashboardOnShutdown) {
			await stopManagedHubDashboardProcess(dashboardDiscoveryPath).catch(
				() => undefined,
			);
		}
		await server.close();
		await daemonTelemetry.dispose().catch(() => undefined);
		process.exit(0);
	};

	let fatalShutdownStarted = false;
	const shutdownFatal = (label: string, error: unknown): void => {
		if (fatalShutdownStarted) {
			return;
		}
		fatalShutdownStarted = true;
		rememberPreserveDashboard(false);
		const message =
			error instanceof Error ? error.stack || error.message : String(error);
		process.stderr.write(`[hub-daemon] ${label}: ${message}\n`);
		void dashboardRestartPromise
			.then(async () => {
				if (!preserveDashboardOnShutdown) {
					await stopManagedHubDashboardProcess(dashboardDiscoveryPath).catch(
						() => undefined,
					);
				}
			})
			.then(() => server.close())
			.catch((closeError) => {
				const closeMessage =
					closeError instanceof Error
						? closeError.stack || closeError.message
						: String(closeError);
				process.stderr.write(
					`[hub-daemon] shutdown after ${label} failed: ${closeMessage}\n`,
				);
			})
			.finally(() => {
				void daemonTelemetry
					.dispose()
					.catch(() => undefined)
					.finally(() => {
						process.exit(1);
					});
			});
	};

	process.on("SIGINT", () => {
		void shutdown();
	});
	process.on("SIGTERM", () => {
		void shutdown();
	});
	process.on("uncaughtException", (error) => {
		shutdownFatal("uncaughtException", error);
	});
	process.on("unhandledRejection", (reason) => {
		if (reason instanceof AgentRuntimeAbortError) {
			process.stderr.write(
				`[hub-daemon] ignored agent runtime abort rejection: ${reason.message}\n`,
			);
			return;
		}
		shutdownFatal("unhandledRejection", reason);
	});

	dashboardRestartPromise = restartManagedHubDashboardProcess({
		discoveryPath: dashboardDiscoveryPath,
		cwd: options.cwd,
	})
		.catch((error) => {
			const message =
				error instanceof Error ? error.stack || error.message : String(error);
			process.stderr.write(
				`[hub-daemon] dashboard restart failed: ${message}\n`,
			);
		})
		.finally(() => {
			dashboardStartupSettled = true;
		});
	await dashboardRestartPromise;

	const shutdownRequest = await shutdownRequestPromise;
	await shutdown(shutdownRequest);
}

void main().catch((error) => {
	const message =
		error instanceof Error ? error.stack || error.message : String(error);
	process.stderr.write(`[hub-daemon] fatal: ${message}\n`);
	process.exit(1);
});
