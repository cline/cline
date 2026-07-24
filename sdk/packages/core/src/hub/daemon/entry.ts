import { AgentRuntimeAbortError } from "@cline/agents";
import { initVcr, resolveClineBuildEnv } from "@cline/shared";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { resolveHubEndpointOptions } from "../discovery/defaults";
import {
	resolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext,
} from "../discovery/workspace";
import { ensureHubWebSocketServer } from "../server";
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

	const hasExplicitEndpoint =
		options.host !== undefined ||
		options.port !== undefined ||
		options.pathname !== undefined ||
		!!process.env.CLINE_HUB_PORT?.trim();

	const endpoint = resolveHubEndpointOptions({
		host: options.host,
		port: options.port,
		pathname: options.pathname,
	});

	const daemonTelemetry = createHubDaemonTelemetry();

	let ensured: Awaited<ReturnType<typeof ensureHubWebSocketServer>>;
	try {
		// ensureHubWebSocketServer serializes on the discovery startup lock,
		// adopts a healthy hub that already owns discovery instead of dying on
		// EADDRINUSE, and (unless the caller pinned an endpoint) falls back to
		// an OS-assigned port when the default port is held by something that
		// cannot be adopted — e.g. a hub whose discovery record was lost.
		// Clients follow the discovery record, not the fixed port, so a
		// fallback hub keeps them working instead of bricking every startup.
		ensured = await ensureHubWebSocketServer({
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
			allowPortFallback: !hasExplicitEndpoint,
		});
	} catch (error) {
		// Flush before the top-level catch exits so failed daemon starts are
		// still visible in telemetry instead of dying silently.
		await daemonTelemetry.dispose().catch(() => undefined);
		throw error;
	}

	const server = ensured.server;
	if (!server) {
		// A compatible hub already owns discovery (e.g. a concurrently spawned
		// daemon won the startup race); nothing left for this process to serve.
		process.stderr.write(
			`[hub-daemon] compatible hub already running at ${ensured.url}; exiting\n`,
		);
		await daemonTelemetry.dispose().catch(() => undefined);
		process.exit(0);
		return;
	}

	const shutdown = async (): Promise<void> => {
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
		if (reason instanceof AgentRuntimeAbortError) {
			process.stderr.write(
				`[hub-daemon] ignored agent runtime abort rejection: ${reason.message}\n`,
			);
			return;
		}
		shutdownFatal("unhandledRejection", reason);
	});

	await new Promise<void>(() => {
		// keep daemon process alive
	});
}

void main().catch((error) => {
	const message =
		error instanceof Error ? error.stack || error.message : String(error);
	process.stderr.write(`[hub-daemon] fatal: ${message}\n`);
	process.exit(1);
});
