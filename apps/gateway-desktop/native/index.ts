/**
 * Broker entrypoint.
 *
 * Spawned by the Tauri shell (or run headless with `bun run
 * dev:broker`). Reads the per-launch bridge secret from the
 * environment — never argv — connects to the locally installed
 * Gateway, and serves the loopback bridge. Prints exactly one ready
 * line (`{type:"ready",port,pid}` — no secret) on stdout for the shell.
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEV_BRIDGE_PORT, DEV_BRIDGE_SECRET } from "../shared/bridge";
import { listSavedProviderSummaries } from "@cline/gateway/client";
import { startBridgeServer } from "./bridge/server";
import { DesktopBroker } from "./gateway/broker";
import { createGatewayPortFactory } from "./gateway/discovery";
import { DesktopStateStore } from "./gateway/state-store";
import { createLogger } from "./logging";

const APP_VERSION = "0.0.1";
const execFileAsync = promisify(execFile);

function appDataDir(): string {
	return (
		process.env.GATEWAY_DESKTOP_DATA_ROOT ??
		join(homedir(), ".cline", "gateway-desktop")
	);
}

async function main(): Promise<void> {
	const dataDir = appDataDir();
	const logDir = join(dataDir, "logs");
	const logger = createLogger(logDir);

	const shellSecret = process.env.GATEWAY_DESKTOP_BRIDGE_SECRET;
	const devBridge = process.env.GATEWAY_DESKTOP_DEV_BRIDGE === "1";
	const secrets: string[] = [];
	if (shellSecret && shellSecret.length >= 8) {
		secrets.push(shellSecret);
	}
	if (devBridge) {
		secrets.push(DEV_BRIDGE_SECRET);
		logger.warn("bridge.devModeEnabled", {});
	}
	if (secrets.length === 0) {
		logger.error("bridge.noSecret", {});
		process.stderr.write(
			"gateway-desktop broker: set GATEWAY_DESKTOP_BRIDGE_SECRET (or GATEWAY_DESKTOP_DEV_BRIDGE=1 for development)\n",
		);
		process.exit(2);
	}

	const stateStore = new DesktopStateStore(join(dataDir, "state.json"));
	const broker = new DesktopBroker({
		connectPort: createGatewayPortFactory({
			clientName: "gateway-desktop",
			clientVersion: APP_VERSION,
		}),
		stateStore,
		logger,
		providerCatalog: await listSavedProviderSummaries(),
		revealDiagnostics: () => revealFolder(logDir),
		chooseWorkspace,
	});

	const bridge = await startBridgeServer({
		broker,
		logger,
		secrets,
		port: devBridge ? DEV_BRIDGE_PORT : 0,
	});

	// The shell parses this single line; the secret never appears here.
	process.stdout.write(
		`${JSON.stringify({ type: "ready", port: bridge.port(), pid: process.pid })}\n`,
	);

	const shutdown = () => {
		// Never interrupts runs: the Gateway owns them; we just close our
		// sockets and leave.
		logger.info("broker.shutdown", {});
		void bridge.close().finally(() => {
			broker.stop();
			process.exit(0);
		});
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	await broker.start();
}

async function chooseWorkspace(): Promise<string | undefined> {
	if (process.platform !== "darwin") {
		throw new Error("Folder selection is currently supported on macOS");
	}
	try {
		const { stdout } = await execFileAsync("osascript", [
			"-e",
			'POSIX path of (choose folder with prompt "Choose a workspace for the next chat")',
		]);
		return stdout.trim().replace(/\/$/, "") || undefined;
	} catch (error) {
		const code = (error as { code?: number }).code;
		if (code === 1) {
			return undefined;
		}
		throw error;
	}
}

/** Fixed native capability: open the diagnostics folder. Not generic. */
function revealFolder(folder: string): void {
	const command =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "explorer"
				: "xdg-open";
	const child = spawn(command, [folder], {
		detached: true,
		stdio: "ignore",
	});
	child.unref();
}

main().catch((error) => {
	process.stderr.write(
		`gateway-desktop broker failed to start: ${
			error instanceof Error ? error.message : String(error)
		}\n`,
	);
	process.exit(1);
});
