import { resolveHubEndpointOptions } from "./defaults";
import { createLocalHubScheduleRuntimeHandlers } from "./runtime-handlers";
import { startHubWebSocketServer } from "./server";
import { resolveSharedHubOwnerContext } from "./workspace";

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

	const server = await startHubWebSocketServer({
		host: endpoint.host,
		port: endpoint.port,
		pathname: endpoint.pathname,
		owner: resolveSharedHubOwnerContext(),
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		cronOptions: { workspaceRoot: options.cwd },
	});

	const shutdown = async (): Promise<void> => {
		await server.close();
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
				process.exit(1);
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
