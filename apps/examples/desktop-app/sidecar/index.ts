import { homedir } from "node:os";
import { setHomeDirIfUnset } from "@cline/core";
import { prewarmWorkspaceMetadata } from "./chat-session";
import {
	createSidecarContext,
	disposeSidecarContext,
	initializeSessionManager,
} from "./context";
import { initializeDesktopEnvironment } from "./environment";
import { createDesktopObservability } from "./observability";
import { resolveWorkspaceRoot } from "./paths";
import { createDesktopRuntimeInfo } from "./runtime-info";
import { startServer } from "./server";
import { BunRuntime, SIDECAR_HOST, SIDECAR_MODE, SIDECAR_PORT } from "./types";

const SHUTDOWN_TIMEOUT_MS = 5_000;
let activeObservability:
	| ReturnType<typeof createDesktopObservability>
	| undefined;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		promise,
		new Promise<T>((_, reject) => {
			timeout = setTimeout(
				() => reject(new Error(`shutdown timed out after ${timeoutMs}ms`)),
				timeoutMs,
			);
		}),
	]).finally(() => {
		if (timeout) {
			clearTimeout(timeout);
		}
	});
}

async function main() {
	if (!BunRuntime) {
		throw new Error("sidecar must be run with Bun");
	}

	const environment = initializeDesktopEnvironment();
	const runtimeInfo = createDesktopRuntimeInfo(environment);
	const workspaceRoot = resolveWorkspaceRoot(process.cwd());
	setHomeDirIfUnset(homedir());
	const observability = createDesktopObservability(runtimeInfo);
	activeObservability = observability;
	if (environment.error) {
		observability.logger.log("Unable to resolve user shell PATH", {
			error: environment.error,
		});
	} else {
		observability.logger.debug("Desktop process PATH initialized", {
			pathChanged: environment.pathChanged,
			platform: process.platform,
		});
	}
	const ctx = createSidecarContext(workspaceRoot, {
		...observability,
		runtimeInfo,
	});
	observability.logger.log("Desktop sidecar starting", {
		workspaceRoot,
		pid: process.pid,
	});

	prewarmWorkspaceMetadata(workspaceRoot);
	await initializeSessionManager(ctx);

	let shuttingDown = false;
	let handlingFatalError = false;
	const shutdown = async (reason = "code_sidecar_shutdown"): Promise<void> => {
		if (shuttingDown) {
			return;
		}
		shuttingDown = true;
		observability.logger.log("Desktop sidecar shutting down", { reason });
		await withTimeout(
			(async () => {
				try {
					await disposeSidecarContext(ctx, reason);
				} finally {
					await observability.dispose();
				}
			})(),
			SHUTDOWN_TIMEOUT_MS,
		);
	};

	const shutdownAndExit = (signal: string): void => {
		void shutdown(`code_sidecar_${signal.toLowerCase()}`).finally(() => {
			process.exit(signal === "SIGINT" ? 130 : 143);
		});
	};

	process.once("SIGINT", () => shutdownAndExit("SIGINT"));
	process.once("SIGTERM", () => shutdownAndExit("SIGTERM"));
	const handleFatalError = (kind: string, error: unknown): void => {
		if (handlingFatalError) {
			process.exit(1);
		}
		handlingFatalError = true;
		observability.logger.error?.("Desktop sidecar process error", {
			kind,
			error,
		});
		void shutdown(`code_sidecar_${kind}`).finally(() => process.exit(1));
	};
	process.on("uncaughtException", (error) => {
		handleFatalError("uncaught_exception", error);
	});
	process.on("unhandledRejection", (error) => {
		handleFatalError("unhandled_rejection", error);
	});
	process.once("beforeExit", () => {
		void shutdown("code_sidecar_before_exit");
	});

	const { port } = startServer(ctx, SIDECAR_PORT, shutdown);
	observability.logger.log("Desktop sidecar ready", {
		port,
		mode: SIDECAR_MODE,
	});

	// A wildcard bind isn't a dialable address; advertise loopback instead.
	const dialHost = SIDECAR_HOST === "0.0.0.0" ? "127.0.0.1" : SIDECAR_HOST;
	const endpoint = `http://${dialHost}:${port}`;
	const wsEndpoint = `ws://${dialHost}:${port}/transport`;
	process.stdout.write(
		`${JSON.stringify({
			type: "ready",
			endpoint,
			wsEndpoint,
			pid: process.pid,
			mode: SIDECAR_MODE,
		})}\n`,
	);
}

main().catch(async (error) => {
	const message = error instanceof Error ? error.message : String(error);
	activeObservability?.logger.error?.("Desktop sidecar process failed", {
		error,
	});
	await activeObservability?.dispose();
	process.stderr.write(`${message}\n`);
	process.exit(1);
});
