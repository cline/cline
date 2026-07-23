import { homedir } from "node:os";
import { setHomeDirIfUnset } from "@cline/core";
import { prewarmWorkspaceMetadata } from "./chat-session";
import {
	createSidecarContext,
	disposeSidecarContext,
	startSessionManagerInitialization,
} from "./context";
import { createDesktopObservability } from "./observability";
import { resolveWorkspaceRoot } from "./paths";
import { startServer } from "./server";
import { ensureLoginShellPath } from "./shell-path";
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

	// When launched from Finder/the Dock the app inherits launchd's minimal
	// PATH, so agent-spawned processes can't find shell-profile-installed
	// tools like `gh`. Kick resolution off first so it overlaps the rest of
	// startup, but await it before the session manager exists — that's what
	// spawns children (agent sessions, MCP servers, scheduled runs).
	const shellPathPromise = ensureLoginShellPath();

	const workspaceRoot = resolveWorkspaceRoot(process.cwd());
	setHomeDirIfUnset(homedir());
	const observability = createDesktopObservability();
	activeObservability = observability;
	const ctx = createSidecarContext(workspaceRoot, observability);
	observability.logger.log("Desktop sidecar starting", {
		workspaceRoot,
		pid: process.pid,
	});

	prewarmWorkspaceMetadata(workspaceRoot);

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
	observability.logger.log("Desktop sidecar transport ready", {
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

	try {
		observability.logger.log(
			"Login shell PATH resolution",
			await shellPathPromise,
		);
		await startSessionManagerInitialization(ctx);
		observability.logger.log("Desktop sidecar runtime ready", {
			port,
			mode: SIDECAR_MODE,
		});
	} catch (error) {
		// Keep the transport alive so the webview can show the bootstrap error and
		// request another initialization attempt.
		observability.logger.error?.("Desktop sidecar runtime bootstrap failed", {
			error,
		});
	}
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
