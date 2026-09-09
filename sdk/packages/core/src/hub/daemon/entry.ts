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
	HUB_LOCK_HELD_EXIT_CODE,
	isHubLockHeldError,
} from "../discovery/instance-lock";
import {
	resolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext,
} from "../discovery/workspace";
import { startHubWebSocketServer } from "../server";
import {
	createHubDaemonShutdownCoordinator,
	HUB_DAEMON_SHUTDOWN_DEADLINE_MS,
} from "./shutdown-coordinator";
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

const HUB_STARTUP_BIND_RETRY_WINDOW_MS = 5_000;
const HUB_STARTUP_BIND_RETRY_DELAY_MS = 250;

function isAddressInUseError(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error as Error & { code?: string }).code === "EADDRINUSE"
	);
}

async function startHubWebSocketServerWithBindRetry(
	bindDeadline: number,
	options: Parameters<typeof startHubWebSocketServer>[0],
): Promise<Awaited<ReturnType<typeof startHubWebSocketServer>>> {
	for (;;) {
		try {
			return await startHubWebSocketServer(options);
		} catch (error) {
			// A retiring predecessor can hold the port — or the instance lock —
			// for a couple of seconds after acking shutdown. Wait either out
			// within the deadline; a lock still held past it means a live Hub
			// owns this context, and the rule is connect or diagnose, never
			// replace (exit code 3, below).
			if (
				(!isAddressInUseError(error) && !isHubLockHeldError(error)) ||
				Date.now() >= bindDeadline
			) {
				throw error;
			}
			await new Promise((resolve) =>
				setTimeout(resolve, HUB_STARTUP_BIND_RETRY_DELAY_MS),
			);
		}
	}
}

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
	const formatError = (error: unknown): string =>
		error instanceof Error ? error.stack || error.message : String(error);
	let shutdownCoordinator:
		| ReturnType<typeof createHubDaemonShutdownCoordinator>
		| undefined;
	let pendingShutdownRequest: { reason: string; exitCode: number } | undefined;
	let pendingShutdownWatchdog: ReturnType<typeof setTimeout> | undefined;
	const requestOrQueueShutdown = (request: {
		reason: string;
		exitCode: number;
	}): Promise<void> | undefined => {
		if (shutdownCoordinator) {
			return shutdownCoordinator.request(request);
		}
		if (
			!pendingShutdownRequest ||
			request.exitCode > pendingShutdownRequest.exitCode
		) {
			pendingShutdownRequest = request;
		}
		if (!pendingShutdownWatchdog) {
			pendingShutdownWatchdog = setTimeout(() => {
				const pending = pendingShutdownRequest ?? request;
				try {
					process.stderr.write(
						`[hub-daemon] startup did not reach shutdown coordination after ${pending.reason}; forcing process exit\n`,
					);
				} finally {
					process.exit(pending.exitCode);
				}
			}, HUB_DAEMON_SHUTDOWN_DEADLINE_MS);
		}
		return undefined;
	};

	let fatalShutdownStarted = false;
	const shutdownFatal = (label: string, error: unknown): void => {
		if (fatalShutdownStarted) {
			return;
		}
		fatalShutdownStarted = true;
		process.stderr.write(`[hub-daemon] ${label}: ${formatError(error)}\n`);
		void requestOrQueueShutdown({ reason: label, exitCode: 1 });
	};

	let terminationSignalCount = 0;
	const handleTerminationSignal = (signal: "SIGINT" | "SIGTERM"): void => {
		terminationSignalCount += 1;
		if (terminationSignalCount > 1) {
			if (shutdownCoordinator) {
				shutdownCoordinator.force({
					reason: `second termination signal (${signal})`,
					exitCode: 0,
				});
				return;
			}
			if (pendingShutdownWatchdog) {
				clearTimeout(pendingShutdownWatchdog);
				pendingShutdownWatchdog = undefined;
			}
			process.exit(pendingShutdownRequest?.exitCode ?? 0);
			return;
		}
		void requestOrQueueShutdown({ reason: signal, exitCode: 0 });
	};
	// Install process handlers before the endpoint can be published. A signal
	// arriving in the publish-to-ready window is queued for the coordinator
	// instead of taking Node/Bun's default exit path and leaving stale discovery.
	process.on("SIGINT", () => handleTerminationSignal("SIGINT"));
	process.on("SIGTERM", () => handleTerminationSignal("SIGTERM"));
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

	// A hub being retired can keep the port bound for a couple of seconds
	// after acking shutdown (its watchdog force-exits below the 3s retire
	// poll). Spawning into that window must wait the port out instead of
	// dying with EADDRINUSE and leaving clients with no hub at all.
	const bindDeadline = Date.now() + HUB_STARTUP_BIND_RETRY_WINDOW_MS;
	let server: Awaited<ReturnType<typeof startHubWebSocketServer>>;
	try {
		server = await startHubWebSocketServerWithBindRetry(bindDeadline, {
			workspaceRoot: options.cwd,
			onShutdownRequested: () => {
				void requestOrQueueShutdown({
					reason: "authenticated HTTP shutdown request",
					exitCode: 0,
				});
			},
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

	shutdownCoordinator = createHubDaemonShutdownCoordinator({
		deadlineMs: HUB_DAEMON_SHUTDOWN_DEADLINE_MS,
		cleanup: async () => {
			const errors: unknown[] = [];
			// Stop supervising but leave the connectors running: they are detached
			// on purpose so a hub restart does not disconnect Slack/Telegram, and
			// the next hub adopts them from their state files.
			try {
				supervisor.dispose();
			} catch (error) {
				errors.push(error);
			} finally {
				setActiveConnectorSupervisor(undefined);
			}
			// Listener and runtime shutdown begin together, but telemetry stays
			// available until runtime/session disposal has settled. The listener's
			// close callback may still hang under Bun; the coordinator watchdog
			// bounds that final await.
			const closing = server.beginClose();
			await Promise.allSettled([closing.transportStopped]);
			try {
				await daemonTelemetry.dispose();
			} catch (error) {
				errors.push(error);
			}
			try {
				await closing.closed;
			} catch (error) {
				errors.push(error);
			}
			if (errors.length > 0) {
				throw new AggregateError(errors, "hub daemon shutdown cleanup failed");
			}
		},
		exit: (code) => process.exit(code),
		onCleanupError: (error) => {
			process.stderr.write(
				`[hub-daemon] shutdown cleanup failed: ${formatError(error)}\n`,
			);
		},
		onForcedExit: ({ reason }) => {
			process.stderr.write(`[hub-daemon] ${reason}; forcing process exit\n`);
		},
	});
	if (pendingShutdownRequest) {
		if (pendingShutdownWatchdog) {
			clearTimeout(pendingShutdownWatchdog);
			pendingShutdownWatchdog = undefined;
		}
		rejectHubDaemonReady(
			new Error("Hub daemon shutdown was requested before readiness"),
		);
		await shutdownCoordinator.request(pendingShutdownRequest);
		return;
	}

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
	if (isHubLockHeldError(error)) {
		// A live Hub owns this context. Losing the singleton race is a
		// diagnosis, not a failure to fight: exit distinctly and leave the
		// running Hub alone.
		process.stderr.write(
			`[hub-daemon] another live Hub owns this data directory: ${error.message}\n`,
		);
		process.exit(HUB_LOCK_HELD_EXIT_CODE);
	}
	const message =
		error instanceof Error ? error.stack || error.message : String(error);
	process.stderr.write(`[hub-daemon] fatal: ${message}\n`);
	process.exit(1);
});
