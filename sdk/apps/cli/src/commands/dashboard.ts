import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";
import { c } from "../utils/output";

export interface DashboardServerHandle {
	listenUrl: string;
	publicUrl: string;
	inviteUrl: string;
	hubUrl?: string;
	stop: () => void | Promise<void>;
}

interface DashboardCommandIo {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
}

export interface RunDashboardCommandOptions {
	cwd?: string;
	host?: string;
	port?: string;
	publicUrl?: string;
	roomSecret?: string;
	openBrowser?: boolean;
	io: DashboardCommandIo;
	startServer?: () => Promise<DashboardServerHandle>;
	openUrl?: (url: string) => Promise<void>;
	waitForShutdown?: (server: DashboardServerHandle) => Promise<void>;
}

const DASHBOARD_PORT_ENV = "CLINE_HUB_DASHBOARD_PORT";
const WEBVIEW_DIST_ENV = "CLINE_HUB_WEBVIEW_DIST_DIR";

function setEnvValue(name: string, value: string | undefined): () => void {
	const previous = process.env[name];
	if (value === undefined) {
		return () => {};
	}
	process.env[name] = value;
	return () => {
		if (previous === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = previous;
		}
	};
}

async function withDashboardEnvironment<T>(
	options: RunDashboardCommandOptions,
	fn: () => Promise<T>,
): Promise<T> {
	const restore = [
		setEnvValue(
			"WORKSPACE_ROOT",
			options.cwd ? resolve(options.cwd) : undefined,
		),
		setEnvValue("HOST", options.host),
		setEnvValue(DASHBOARD_PORT_ENV, options.port),
		setEnvValue("PUBLIC_URL", options.publicUrl),
		setEnvValue("ROOM_SECRET", options.roomSecret),
		setEnvValue(WEBVIEW_DIST_ENV, resolveDefaultWebviewDistDir()),
	];
	try {
		return await fn();
	} finally {
		for (let i = restore.length - 1; i >= 0; i--) {
			restore[i]?.();
		}
	}
}

function resolveDefaultWebviewDistDir(): string | undefined {
	if (process.env[WEBVIEW_DIST_ENV]?.trim()) {
		return undefined;
	}

	const moduleDir = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		// Source checkout: sdk/apps/cli/src/commands/dashboard.ts
		join(moduleDir, "../../../cline-hub/dist/webview"),
		// Node bundle: sdk/apps/cli/dist/index.js
		join(moduleDir, "cline-hub/webview"),
		// Compiled platform package: sdk/apps/cli/dist/<platform>/bin/cline
		join(dirname(process.execPath), "../cline-hub/webview"),
	];

	return candidates.find((candidate) => existsSync(candidate));
}

async function startDefaultDashboardServer(): Promise<DashboardServerHandle> {
	const { startClineHubDashboardServer } = await import("@cline/cline-hub");
	return await startClineHubDashboardServer();
}

async function openDefaultUrl(url: string): Promise<void> {
	await open(url, { wait: false });
}

function waitForProcessShutdown(server: DashboardServerHandle): Promise<void> {
	return new Promise<void>((resolveShutdown) => {
		let settled = false;

		const cleanup = () => {
			process.off("SIGINT", handleSignal);
			process.off("SIGTERM", handleSignal);
		};

		const stop = async () => {
			if (settled) return;
			settled = true;
			cleanup();
			await server.stop();
			resolveShutdown();
		};

		function handleSignal() {
			void stop();
		}

		process.on("SIGINT", handleSignal);
		process.on("SIGTERM", handleSignal);
	});
}

export async function runDashboardCommand(
	options: RunDashboardCommandOptions,
): Promise<number> {
	try {
		const server = await withDashboardEnvironment(options, () =>
			(options.startServer ?? startDefaultDashboardServer)(),
		);
		const dashboardUrl =
			server.inviteUrl || server.publicUrl || server.listenUrl;
		options.io.writeln(
			`${c.green}Cline dashboard listening at${c.reset} ${dashboardUrl}`,
		);
		if (server.hubUrl) {
			options.io.writeln(`${c.dim}Hub endpoint: ${server.hubUrl}${c.reset}`);
		}

		if (options.openBrowser !== false) {
			try {
				await (options.openUrl ?? openDefaultUrl)(dashboardUrl);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				options.io.writeErr(`Failed to open browser: ${message}`);
			}
		}

		await (options.waitForShutdown ?? waitForProcessShutdown)(server);
		return 0;
	} catch (error) {
		options.io.writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
}
