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

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	process.chdir(options.cwd);

	const endpoint = resolveHubEndpointOptions({
		host: options.host,
		port: options.port,
		pathname: options.pathname,
	});

	const daemonTelemetry = createHubDaemonTelemetry();

	// The daemon's lifetime is tied to its server, so an authorized HTTP
	// `POST /shutdown` must end the process just like SIGTERM does — that
	// route is how auto-update restarts and `cline hub stop` retire the hub,
	// and neither sends a signal when the HTTP request succeeds. The route is
	// reachable with an authorized request the moment the discovery record is
	// written, which happens before startHubWebSocketServer() resolves, so
	// the exit path must exist before the server starts: an early request
	// arms the exit watchdog immediately, and the rest of the teardown runs
	// once the server handle is available. HTTP- and signal-delivered
	// requests share this gate, so a caller that sends both (as
	// retireDiscoveredHub does) runs a single teardown.
	let shutdownStarted = false;
	let completeShutdown: (() => void) | undefined;
	const requestDaemonShutdown = (): void => {
		if (shutdownStarted) {
			return;
		}
		shutdownStarted = true;
		// server.close() can stall forever (Bun never resolves it once a WebSocket
		// upgrade happened), and with signal handlers installed nothing else will
		// end the process — so the exit must not depend on the graceful path.
		armHubDaemonShutdownWatchdog({
			deadlineMs: HUB_DAEMON_SHUTDOWN_DEADLINE_MS,
			exitCode: 0,
			onTimeout: () => {
				process.stderr.write(
					"[hub-daemon] graceful shutdown stalled; forcing exit\n",
				);
			},
		});
		completeShutdown?.();
	};

	let server: Awaited<ReturnType<typeof startHubWebSocketServer>>;
	try {
		server = await startHubWebSocketServer({
			onShutdownRequested: requestDaemonShutdown,
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

	completeShutdown = () => {
		void (async () => {
			// Stop supervising but leave the connectors running: they are detached on
			// purpose so a hub restart does not disconnect Slack/Telegram, and the next
			// hub adopts them from their state files.
			supervisor.dispose();
			setActiveConnectorSupervisor(undefined);
			await server.close();
			await daemonTelemetry.dispose().catch(() => undefined);
			process.exit(0);
		})();
	};
	if (shutdownStarted) {
		// An authorized /shutdown landed while the server was still starting.
		// The watchdog is already armed; finish the teardown now.
		completeShutdown();
	}

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
		requestDaemonShutdown();
	});
	process.on("SIGTERM", () => {
		requestDaemonShutdown();
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
