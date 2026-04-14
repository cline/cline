import { createSidecarContext, initializeSessionManager } from "./context";
import { resolveWorkspaceRoot } from "./paths";
import { startServer } from "./server";
import { BunRuntime, SIDECAR_MODE, SIDECAR_PORT } from "./types";

async function main() {
	if (!BunRuntime) {
		throw new Error("sidecar must be run with Bun");
	}

	const workspaceRoot = resolveWorkspaceRoot(process.cwd());
	const ctx = createSidecarContext(workspaceRoot);

	await initializeSessionManager(ctx);

	const { port } = startServer(ctx, SIDECAR_PORT);

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
