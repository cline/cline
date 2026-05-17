import {
	createSidecarContext,
	disposeSidecarContext,
	initializeSessionManager,
} from "./context";
import { resolveWorkspaceRoot } from "./paths";
import { startServer } from "./server";
import { BunRuntime, SIDECAR_MODE, SIDECAR_PORT } from "./types";

const SHUTDOWN_TIMEOUT_MS = 5_000;

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

	const workspaceRoot = resolveWorkspaceRoot(process.cwd());
	const ctx = createSidecarContext(workspaceRoot);

	await initializeSessionManager(ctx);

	let shuttingDown = false;
	const shutdown = async (reason = "code_sidecar_shutdown"): Promise<void> => {
		if (shuttingDown) {
			return;
		}
		shuttingDown = true;
		await withTimeout(disposeSidecarContext(ctx, reason), SHUTDOWN_TIMEOUT_MS);
	};

	const shutdownAndExit = (signal: string): void => {
		void shutdown(`code_sidecar_${signal.toLowerCase()}`).finally(() => {
			process.exit(signal === "SIGINT" ? 130 : 143);
		});
	};

	process.once("SIGINT", () => shutdownAndExit("SIGINT"));
	process.once("SIGTERM", () => shutdownAndExit("SIGTERM"));
	process.once("beforeExit", () => {
		void shutdown("code_sidecar_before_exit");
	});

	const { port } = startServer(ctx, SIDECAR_PORT, shutdown);

	const endpoint = `http://127.0.0.1:${port}`;
	const wsEndpoint = `ws://127.0.0.1:${port}/transport`;
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

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exit(1);
});
