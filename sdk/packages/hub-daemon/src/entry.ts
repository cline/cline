import { AgentRuntimeAbortError } from "@cline/agents";
import {
	ConnectorSupervisor,
	cleanupConnectorInstanceViaCli,
	reconnectDaemonConnectors,
	setActiveConnectorSupervisor,
} from "@cline/core/hub-runtime";
import {
	HUB_VERSION,
	resolveHubEndpointOptions,
	resolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext,
} from "@cline/hub";
import {
	claimHubDaemonProcess,
	initVcr,
	resolveClineBuildEnv,
} from "@cline/shared";
import { createLocalHubScheduleRuntimeHandlers } from "./runtime-handlers";
import { startHubWebSocketServer } from "./server";
import { createHubDaemonTelemetry } from "./telemetry";

// The launcher marks this process so Hub clients cannot recursively spawn a
// second daemon. Scrub the marker before the daemon creates connector, tool,
// hook, or MCP child processes so they never inherit the Hub personality.
claimHubDaemonProcess();
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
	if (process.argv.slice(2).includes("--version")) {
		process.stdout.write(`${HUB_VERSION}\n`);
		resolveHubDaemonReady();
		return;
	}
	const options = parseArgs(process.argv.slice(2));
	process.chdir(options.cwd);

	const endpoint = resolveHubEndpointOptions({
		host: options.host,
		port: options.port,
		pathname: options.pathname,
	});

	const daemonTelemetry = createHubDaemonTelemetry();

	let server: Awaited<ReturnType<typeof startHubWebSocketServer>>;
	try {
		server = await startHubWebSocketServer({
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

	const shutdown = async (): Promise<void> => {
		// Stop supervising but leave the connectors running: they are detached on
		// purpose so a hub restart does not disconnect Slack/Telegram, and the next
		// hub adopts them from their state files.
		supervisor.dispose();
		setActiveConnectorSupervisor(undefined);
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
