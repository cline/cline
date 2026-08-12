import { AgentRuntimeAbortError } from "@cline/agents";
import { initVcr, resolveClineBuildEnv } from "@cline/shared";
import { cleanupConnectorInstanceViaCli } from "../../services/connectors/connector-cleanup";
import {
	ConnectorSupervisor,
	setActiveConnectorSupervisor,
} from "../../services/connectors/connector-supervisor";
import { reconnectDaemonConnectors } from "../../services/connectors/daemon-connector-reconnect";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { resolveHubEndpointOptions } from "../discovery/defaults";
import {
	resolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext,
} from "../discovery/workspace";
import { startHubWebSocketServer } from "../server";
import {
	armHubDaemonShutdownWatchdog,
	HUB_DAEMON_SHUTDOWN_DEADLINE_MS,
} from "./shutdown-watchdog";
import { createHubDaemonTelemetry } from "./telemetry";

initVcr(process.env.CLINE_VCR);

let resolveHubDaemonReady!: () => void;
let rejectHubDaemonReady!: (error: unknown) => void;

/**
 * Resolves only after the daemon WebSocket server is listening and its process
 * lifecycle handlers are installed.
 */
export const hubDaemonReady = new Promise<void>((resolve, reject) => {
	resolveHubDaemonReady = resolve;
	rejectHubDaemonReady = reject;
});

// The daemon entrypoint also runs standalone, where no importer observes the
// readiness promise. Keep startup failures handled by the fatal path below.
void hubDaemonReady.catch(() => undefined);

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

/**
 * Abort-family rejections are expected daemon noise, not fatal faults: when a
 * user cancels a turn, in-flight provider streams and fetches can reject on a
 * floating promise after the run has already settled (DOMException
 * "AbortError" from fetch/undici, Node ABORT_ERR, or the runtime's own
 * AgentRuntimeAbortError). Exiting on those kills every resident session in
 * the daemon — the next message from any connected client then lands on
 * `session_not_found` and forces a rebuild from disk.
 */
export function isAbortRejection(reason: unknown): boolean {
	if (reason instanceof AgentRuntimeAbortError) {
		return true;
	}
	if (reason instanceof Error) {
		if (reason.name === "AbortError") {
			return true;
		}
		const code = (reason as { code?: unknown }).code;
		if (code === "ABORT_ERR") {
			return true;
		}
	}
	return false;
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	process.chdir(options.cwd);

	const endpoint = resolveHubEndpointOptions({
		host: options.host,
		port: options.port,
		pathname: options.pathname,
	});

	const daemonTelemetry = createHubDaemonTelemetry();
	let requestDaemonShutdown: () => void = () => {};

	let server: Awaited<ReturnType<typeof startHubWebSocketServer>>;
	try {
		server = await startHubWebSocketServer({
			onShutdownRequested: () => requestDaemonShutdown(),
			host: endpoint.host,
			port: endpoint.port,
			pathname: endpoint.pathname,
			owner:
				resolveClineBuildEnv() === "production"
					? resolveProductionHubOwnerContext()
					: resolveSharedHubOwnerContext(),
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

	// Owns connector processes for this hub's lifetime: one instance per
	// (channel, instanceId), reaping and backoff restarts when they die.
	const supervisor = new ConnectorSupervisor({
		cleanupInstance: (channel, instanceId) =>
			cleanupConnectorInstanceViaCli(channel, instanceId),
	});
	setActiveConnectorSupervisor(supervisor);

	let shutdownStarted = false;
	const shutdown = async (): Promise<void> => {
		if (shutdownStarted) {
			return;
		}
		shutdownStarted = true;
		armHubDaemonShutdownWatchdog({
			deadlineMs: HUB_DAEMON_SHUTDOWN_DEADLINE_MS,
			exitCode: 0,
			onTimeout: () => {
				process.stderr.write(
					"[hub-daemon] graceful shutdown stalled; forcing exit\n",
				);
			},
		});
		// Stop supervising but leave the connectors running: they are detached on
		// purpose so a hub restart does not disconnect Slack/Telegram, and the next
		// hub adopts them from their state files.
		supervisor.dispose();
		setActiveConnectorSupervisor(undefined);
		await server.close();
		await daemonTelemetry.dispose().catch(() => undefined);
		process.exit(0);
	};
	requestDaemonShutdown = () => {
		void shutdown();
	};

	let fatalShutdownStarted = false;
	const shutdownFatal = (label: string, error: unknown): void => {
		if (fatalShutdownStarted) {
			return;
		}
		fatalShutdownStarted = true;
		armHubDaemonShutdownWatchdog({
			deadlineMs: HUB_DAEMON_SHUTDOWN_DEADLINE_MS,
			exitCode: 1,
			onTimeout: () => {
				process.stderr.write(
					`[hub-daemon] shutdown after ${label} stalled; forcing exit\n`,
				);
			},
		});
		const message =
			error instanceof Error ? error.stack || error.message : String(error);
		process.stderr.write(`[hub-daemon] ${label}: ${message}\n`);
		void server
			.close()
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
		if (isAbortRejection(reason)) {
			const message = reason instanceof Error ? reason.message : String(reason);
			process.stderr.write(
				`[hub-daemon] ignored abort rejection: ${message}\n`,
			);
			return;
		}
		shutdownFatal("unhandledRejection", reason);
	});

	resolveHubDaemonReady();
	try {
		// Adopt first: connectors that outlived the previous hub have to be known
		// before recovery runs, so they are restarted onto this hub's session
		// instead of being started a second time alongside themselves.
		supervisor.adoptRunningConnectors();
		await reconnectDaemonConnectors();
	} catch (error) {
		const message =
			error instanceof Error ? error.stack || error.message : String(error);
		process.stderr.write(
			`[hub-daemon] connector reconnect failed: ${message}\n`,
		);
	}
	await new Promise<void>(() => {
		// keep daemon process alive
	});
}

void main().catch((error) => {
	rejectHubDaemonReady(error);
	const message =
		error instanceof Error ? error.stack || error.message : String(error);
	process.stderr.write(`[hub-daemon] fatal: ${message}\n`);
	process.exit(1);
});
