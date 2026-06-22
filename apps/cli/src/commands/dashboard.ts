import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { arch, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	clearHubDashboardDiscovery,
	ensureDetachedHubServer,
	type HubDashboardDiscoveryRecord,
	type HubServerDiscoveryRecord,
	isHubDashboardPidAlive,
	readHubDashboardDiscovery,
	readHubDiscovery,
	resolveHubDashboardDiscoveryPath,
	resolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext,
	writeHubDashboardDiscovery,
} from "@cline/core";
import { resolveClineBuildEnv } from "@cline/shared";
import open from "open";
import { configureSandboxEnvironment } from "../utils/helpers";
import { buildCliSubcommandCommand } from "../utils/internal-launch";
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
	action?: "open" | "restart" | "serve" | "stop";
	configDir?: string;
	cwd?: string;
	dataDir?: string;
	host?: string;
	port?: string;
	publicUrl?: string;
	roomSecret?: string;
	openBrowser?: boolean;
	io: DashboardCommandIo;
	startServer?: () => Promise<DashboardServerHandle>;
	ensureDashboard?: () => Promise<HubDashboardDiscoveryRecord>;
	stopDashboard?: () => Promise<boolean>;
	openUrl?: (url: string) => Promise<void>;
	waitForShutdown?: (server: DashboardServerHandle) => Promise<void>;
}

const DASHBOARD_PORT_ENV = "CLINE_HUB_DASHBOARD_PORT";
const WEBVIEW_DIST_ENV = "CLINE_HUB_WEBVIEW_DIST_DIR";
const DASHBOARD_DISCOVERY_PATH_ENV = "CLINE_HUB_DASHBOARD_DISCOVERY_PATH";
const DASHBOARD_STARTUP_TIMEOUT_MS = 8_000;
const DASHBOARD_STARTUP_POLL_MS = 200;
const DASHBOARD_STOP_TIMEOUT_MS = 3_000;
const DASHBOARD_STOP_POLL_MS = 100;
const DASHBOARD_LAUNCHER_ENV = "CLINE_HUB_DASHBOARD_LAUNCHER";
const DASHBOARD_ARGS_ENV = "CLINE_HUB_DASHBOARD_ARGS";

function setEnvValue(name: string, value: string | undefined): () => void {
	const previous = process.env[name];
	if (value !== undefined) {
		process.env[name] = value;
	}
	return () => {
		if (previous === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = previous;
		}
	};
}

const SANDBOX_ENV_KEYS = [
	"CLINE_SANDBOX",
	"CLINE_SANDBOX_DATA_DIR",
	"CLINE_DATA_DIR",
	"CLINE_DB_DATA_DIR",
	"CLINE_SESSION_DATA_DIR",
	"CLINE_TEAM_DATA_DIR",
	"CLINE_PROVIDER_SETTINGS_PATH",
	"CLINE_HOOKS_LOG_PATH",
] as const;

async function withDashboardEnvironment<T>(
	options: RunDashboardCommandOptions,
	fn: () => Promise<T>,
): Promise<T> {
	const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
	const restore = [
		setEnvValue("WORKSPACE_ROOT", options.cwd ? cwd : undefined),
		setEnvValue("CLINE_DIR", options.configDir?.trim() || undefined),
		setEnvValue("HOST", options.host),
		setEnvValue(DASHBOARD_PORT_ENV, options.port),
		setEnvValue("PUBLIC_URL", options.publicUrl),
		setEnvValue("ROOM_SECRET", options.roomSecret),
		setEnvValue(WEBVIEW_DIST_ENV, resolveDefaultWebviewDistDir()),
		...SANDBOX_ENV_KEYS.map((key) => setEnvValue(key, undefined)),
	];
	if (options.dataDir || process.env.CLINE_SANDBOX?.trim() === "1") {
		configureSandboxEnvironment({
			enabled: true,
			cwd,
			explicitDir: options.dataDir,
		});
	}
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
		...resolveInstalledPlatformPackageWebviewCandidates(),
		// Source checkout: apps/cli/src/commands/dashboard.ts
		join(moduleDir, "../../../cline-hub/dist/webview"),
		// Node bundle: apps/cli/dist/index.js
		join(moduleDir, "cline-hub/webview"),
		// Compiled platform package: apps/cli/dist/<platform>/bin/cline
		join(dirname(process.execPath), "../cline-hub/webview"),
	];

	return candidates.find((candidate) => existsSync(candidate));
}

function resolveInstalledPlatformPackageWebviewCandidates(): string[] {
	const packageName = resolvePlatformPackageName();
	const starts = [
		process.env.CLINE_WRAPPER_PATH
			? dirname(process.env.CLINE_WRAPPER_PATH)
			: undefined,
		dirname(process.execPath),
	].filter((value): value is string => !!value?.trim());
	const candidates: string[] = [];
	for (const start of starts) {
		let current = start;
		for (;;) {
			candidates.push(
				join(current, "node_modules", packageName, "cline-hub/webview"),
			);
			const parent = dirname(current);
			if (parent === current) break;
			current = parent;
		}
	}
	return candidates;
}

function resolvePlatformPackageName(): string {
	const platformName = platform() === "win32" ? "windows" : platform();
	return `@cline/cli-${platformName}-${arch()}`;
}

async function startDefaultDashboardServer(): Promise<DashboardServerHandle> {
	const { startClineHubDashboardServer } = await import("@cline/cline-hub");
	return await startClineHubDashboardServer();
}

async function openDefaultUrl(url: string): Promise<void> {
	await open(url, { wait: false });
}

function resolveCliHubOwnerContext() {
	return resolveClineBuildEnv() === "production"
		? resolveProductionHubOwnerContext()
		: resolveSharedHubOwnerContext();
}

function resolveDashboardDiscoveryPath(): string {
	return (
		process.env[DASHBOARD_DISCOVERY_PATH_ENV]?.trim() ||
		resolveHubDashboardDiscoveryPath(resolveCliHubOwnerContext())
	);
}

async function waitForPidToExit(pid: number): Promise<boolean> {
	const deadline = Date.now() + DASHBOARD_STOP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (!isHubDashboardPidAlive(pid)) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, DASHBOARD_STOP_POLL_MS));
	}
	return false;
}

async function isDashboardHealthy(
	record: HubDashboardDiscoveryRecord,
): Promise<boolean> {
	if (!isHubDashboardPidAlive(record.pid)) {
		return false;
	}
	try {
		const response = await fetch(new URL("/health", record.listenUrl));
		return response.ok;
	} catch {
		return false;
	}
}

async function stopDefaultDashboard(): Promise<boolean> {
	const discoveryPath = resolveDashboardDiscoveryPath();
	const discovered = await readHubDashboardDiscovery(discoveryPath);
	if (!discovered?.pid) {
		await clearHubDashboardDiscovery(discoveryPath).catch(() => undefined);
		return false;
	}
	try {
		process.kill(discovered.pid, "SIGTERM");
	} catch {
		await clearHubDashboardDiscovery(discoveryPath).catch(() => undefined);
		return false;
	}
	const stopped = await waitForPidToExit(discovered.pid);
	await clearHubDashboardDiscovery(discoveryPath).catch(() => undefined);
	return stopped;
}

function spawnDetachedDashboardServer(cwd: string): void {
	const command = buildCliSubcommandCommand("dashboard", ["serve"], { cwd });
	if (!command) {
		throw new Error("unable to resolve CLI command for dashboard process");
	}
	const child = spawn(command.launcher, command.childArgs, {
		cwd,
		detached: true,
		stdio: "ignore",
		env: {
			...process.env,
			CLINE_NO_INTERACTIVE: "1",
			[DASHBOARD_DISCOVERY_PATH_ENV]: resolveDashboardDiscoveryPath(),
		},
		windowsHide: true,
	});
	child.unref();
}

async function waitForDashboardDiscovery(
	discoveryPath: string,
	timeoutMs = DASHBOARD_STARTUP_TIMEOUT_MS,
): Promise<HubDashboardDiscoveryRecord> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const discovered = await readHubDashboardDiscovery(discoveryPath);
		if (discovered && (await isDashboardHealthy(discovered))) {
			return discovered;
		}
		await new Promise((resolve) =>
			setTimeout(resolve, DASHBOARD_STARTUP_POLL_MS),
		);
	}
	throw new Error("Timed out waiting for dashboard startup.");
}

function hasHubManagedDashboardLaunchSpec(): boolean {
	return Boolean(
		process.env[DASHBOARD_LAUNCHER_ENV]?.trim() &&
			process.env[DASHBOARD_ARGS_ENV]?.trim(),
	);
}

function isSameHubProcess(
	before: HubServerDiscoveryRecord | undefined,
	after: HubServerDiscoveryRecord | undefined,
): boolean {
	return Boolean(
		before &&
			after &&
			before.url === after.url &&
			before.pid === after.pid &&
			before.startedAt === after.startedAt,
	);
}

async function ensureDefaultDashboard(
	options: RunDashboardCommandOptions,
): Promise<HubDashboardDiscoveryRecord> {
	return await withDashboardEnvironment(options, async () => {
		const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
		const owner = resolveCliHubOwnerContext();
		const hubBefore = await readHubDiscovery(owner.discoveryPath);
		await ensureDetachedHubServer(cwd);
		const hubAfter = await readHubDiscovery(owner.discoveryPath);
		const discoveryPath = resolveDashboardDiscoveryPath();
		const discovered = await readHubDashboardDiscovery(discoveryPath);
		if (discovered && (await isDashboardHealthy(discovered))) {
			return discovered;
		}
		if (
			hasHubManagedDashboardLaunchSpec() &&
			!isSameHubProcess(hubBefore, hubAfter)
		) {
			return await waitForDashboardDiscovery(discoveryPath);
		}
		await stopDefaultDashboard().catch(() => undefined);
		spawnDetachedDashboardServer(cwd);
		return await waitForDashboardDiscovery(discoveryPath);
	});
}

async function writeDashboardDiscovery(
	server: DashboardServerHandle,
): Promise<void> {
	const timestamp = new Date().toISOString();
	await writeHubDashboardDiscovery(resolveDashboardDiscoveryPath(), {
		pid: process.pid,
		listenUrl: server.listenUrl,
		publicUrl: server.publicUrl,
		inviteUrl: server.inviteUrl,
		hubUrl: server.hubUrl,
		startedAt: timestamp,
		updatedAt: timestamp,
	});
}

async function clearDashboardDiscovery(): Promise<void> {
	await clearHubDashboardDiscovery(resolveDashboardDiscoveryPath()).catch(
		() => undefined,
	);
}

export function waitForProcessShutdown(
	server: DashboardServerHandle,
): Promise<void> {
	return new Promise<void>((resolveShutdown, rejectShutdown) => {
		let settled = false;

		const cleanup = () => {
			process.off("SIGINT", handleSignal);
			process.off("SIGTERM", handleSignal);
		};

		const stop = async () => {
			if (settled) return;
			settled = true;
			cleanup();
			try {
				await server.stop();
				resolveShutdown();
			} catch (error) {
				rejectShutdown(error);
			}
		};

		function handleSignal() {
			void stop();
		}

		process.on("SIGINT", handleSignal);
		process.on("SIGTERM", handleSignal);
	});
}

async function runDashboardServeCommand(
	options: RunDashboardCommandOptions,
): Promise<number> {
	const server = await withDashboardEnvironment(options, () =>
		(options.startServer ?? startDefaultDashboardServer)(),
	);
	await writeDashboardDiscovery(server);
	const dashboardUrl = server.inviteUrl || server.publicUrl || server.listenUrl;
	options.io.writeln(
		`${c.green}Cline dashboard listening at${c.reset} ${dashboardUrl}`,
	);
	if (server.hubUrl) {
		options.io.writeln(`${c.dim}Hub endpoint: ${server.hubUrl}${c.reset}`);
	}
	try {
		await (options.waitForShutdown ?? waitForProcessShutdown)(server);
	} finally {
		await clearDashboardDiscovery();
	}
	return 0;
}

async function openDashboardUrl(
	options: RunDashboardCommandOptions,
	record: Pick<
		HubDashboardDiscoveryRecord,
		"inviteUrl" | "publicUrl" | "listenUrl"
	>,
): Promise<void> {
	const dashboardUrl = record.inviteUrl || record.publicUrl || record.listenUrl;
	options.io.writeln(
		`${c.green}Cline dashboard listening at${c.reset} ${dashboardUrl}`,
	);
	if (options.openBrowser !== false) {
		try {
			await (options.openUrl ?? openDefaultUrl)(dashboardUrl);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			options.io.writeErr(`Failed to open browser: ${message}`);
		}
	}
}

export async function runDashboardCommand(
	options: RunDashboardCommandOptions,
): Promise<number> {
	try {
		const action = options.action ?? "open";
		if (action === "serve") {
			return await runDashboardServeCommand(options);
		}
		if (action === "stop") {
			const stopped = options.stopDashboard
				? await options.stopDashboard()
				: await withDashboardEnvironment(options, stopDefaultDashboard);
			options.io.writeln(JSON.stringify({ stopped }));
			return 0;
		}
		if (action === "restart") {
			if (options.stopDashboard) {
				await options.stopDashboard();
			} else {
				await withDashboardEnvironment(options, stopDefaultDashboard);
			}
		}
		const record = await (
			options.ensureDashboard ?? (() => ensureDefaultDashboard(options))
		)();
		await openDashboardUrl(options, record);
		if (record.hubUrl) {
			options.io.writeln(`${c.dim}Hub endpoint: ${record.hubUrl}${c.reset}`);
		}
		return 0;
	} catch (error) {
		options.io.writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
}
