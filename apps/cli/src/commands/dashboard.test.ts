import { mkdirSync, mkdtempSync } from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDashboardCommand, waitForProcessShutdown } from "./dashboard";

const ENV_KEYS = [
	"WORKSPACE_ROOT",
	"CLINE_DIR",
	"CLINE_SANDBOX",
	"CLINE_SANDBOX_DATA_DIR",
	"CLINE_DATA_DIR",
	"CLINE_DB_DATA_DIR",
	"CLINE_SESSION_DATA_DIR",
	"CLINE_TEAM_DATA_DIR",
	"CLINE_PROVIDER_SETTINGS_PATH",
	"CLINE_HOOKS_LOG_PATH",
	"HOST",
	"CLINE_HUB_DASHBOARD_PORT",
	"PUBLIC_URL",
	"ROOM_SECRET",
	"CLINE_HUB_WEBVIEW_DIST_DIR",
	"CLINE_HUB_DASHBOARD_DISCOVERY_PATH",
	"CLINE_WRAPPER_PATH",
] as const;

const originalEnv = Object.fromEntries(
	ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
	for (const key of ENV_KEYS) {
		const value = originalEnv[key];
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
});

describe("runDashboardCommand", () => {
	it("serves the dashboard in the foreground and waits for shutdown", async () => {
		const output: string[] = [];
		const errors: string[] = [];
		const stop = vi.fn();
		let observedEnv:
			| {
					workspaceRoot: string | undefined;
					clineDir: string | undefined;
					clineDataDir: string | undefined;
					providerSettingsPath: string | undefined;
					host: string | undefined;
					port: string | undefined;
					publicUrl: string | undefined;
					roomSecret: string | undefined;
					webviewDistDir: string | undefined;
			  }
			| undefined;
		const webviewDistDir = mkdtempSync(join(tmpdir(), "cline-webview-dist-"));
		mkdirSync(webviewDistDir, { recursive: true });
		process.env.CLINE_HUB_WEBVIEW_DIST_DIR = webviewDistDir;

		const exitCode = await runDashboardCommand({
			action: "serve",
			configDir: "/tmp/cline-config",
			cwd: "sdk",
			dataDir: ".cline-dashboard-data",
			host: "127.0.0.1",
			port: "9090",
			publicUrl: "http://127.0.0.1:9090",
			roomSecret: "secret",
			io: {
				writeln: (text) => output.push(text ?? ""),
				writeErr: (text) => errors.push(text),
			},
			startServer: async () => {
				observedEnv = {
					workspaceRoot: process.env.WORKSPACE_ROOT,
					clineDir: process.env.CLINE_DIR,
					clineDataDir: process.env.CLINE_DATA_DIR,
					providerSettingsPath: process.env.CLINE_PROVIDER_SETTINGS_PATH,
					host: process.env.HOST,
					port: process.env.CLINE_HUB_DASHBOARD_PORT,
					publicUrl: process.env.PUBLIC_URL,
					roomSecret: process.env.ROOM_SECRET,
					webviewDistDir: process.env.CLINE_HUB_WEBVIEW_DIST_DIR,
				};
				return {
					listenUrl: "http://127.0.0.1:9090/",
					publicUrl: "http://127.0.0.1:9090",
					inviteUrl: "http://127.0.0.1:9090/?roomSecret=secret",
					hubUrl: "ws://127.0.0.1:25463/hub",
					stop,
				};
			},
			waitForShutdown: async (server) => {
				await server.stop();
			},
		});

		expect(exitCode).toBe(0);
		expect(observedEnv).toEqual({
			workspaceRoot: resolve("sdk"),
			clineDir: "/tmp/cline-config",
			clineDataDir: resolve("sdk", ".cline-dashboard-data"),
			providerSettingsPath: join(
				resolve("sdk", ".cline-dashboard-data"),
				"settings",
				"providers.json",
			),
			host: "127.0.0.1",
			port: "9090",
			publicUrl: "http://127.0.0.1:9090",
			roomSecret: "secret",
			webviewDistDir,
		});
		expect(stop).toHaveBeenCalledTimes(1);
		expect(output.join("\n")).toContain("Cline dashboard listening at");
		expect(output.join("\n")).toContain("ws://127.0.0.1:25463/hub");
		expect(errors).toEqual([]);
		expect(process.env.WORKSPACE_ROOT).toBe(originalEnv.WORKSPACE_ROOT);
		expect(process.env.CLINE_HUB_WEBVIEW_DIST_DIR).toBe(webviewDistDir);
	});

	it("opens a detached dashboard and exits without waiting for shutdown", async () => {
		const output: string[] = [];
		const errors: string[] = [];
		const opened: string[] = [];
		const ensureDashboard = vi.fn(async () => ({
			pid: 123,
			listenUrl: "http://127.0.0.1:8787/",
			publicUrl: "http://127.0.0.1:8787",
			inviteUrl: "http://127.0.0.1:8787",
			hubUrl: "ws://127.0.0.1:25463/hub",
			startedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}));
		const waitForShutdown = vi.fn();

		const exitCode = await runDashboardCommand({
			io: {
				writeln: (text) => output.push(text ?? ""),
				writeErr: (text) => errors.push(text),
			},
			ensureDashboard,
			openUrl: async (url) => {
				opened.push(url);
			},
			waitForShutdown,
		});

		expect(exitCode).toBe(0);
		expect(ensureDashboard).toHaveBeenCalledTimes(1);
		expect(waitForShutdown).not.toHaveBeenCalled();
		expect(opened).toEqual(["http://127.0.0.1:8787"]);
		expect(output.join("\n")).toContain("Cline dashboard listening at");
		expect(output.join("\n")).toContain("ws://127.0.0.1:25463/hub");
		expect(errors).toEqual([]);
	});

	it("honors --no-open behavior", async () => {
		const openUrl = vi.fn();

		const exitCode = await runDashboardCommand({
			openBrowser: false,
			io: {
				writeln: () => {},
				writeErr: () => {},
			},
			ensureDashboard: async () => ({
				pid: 123,
				listenUrl: "http://127.0.0.1:8787/",
				publicUrl: "http://127.0.0.1:8787",
				inviteUrl: "http://127.0.0.1:8787",
				startedAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			}),
			openUrl,
		});

		expect(exitCode).toBe(0);
		expect(openUrl).not.toHaveBeenCalled();
	});

	it("stops a detached dashboard", async () => {
		const output: string[] = [];
		const stopDashboard = vi.fn(async () => true);

		const exitCode = await runDashboardCommand({
			action: "stop",
			io: {
				writeln: (text) => output.push(text ?? ""),
				writeErr: () => {},
			},
			stopDashboard,
		});

		expect(exitCode).toBe(0);
		expect(stopDashboard).toHaveBeenCalledTimes(1);
		expect(output).toEqual([JSON.stringify({ stopped: true })]);
	});

	it("restarts a detached dashboard before opening it", async () => {
		const stopDashboard = vi.fn(async () => true);
		const ensureDashboard = vi.fn(async () => ({
			pid: 456,
			listenUrl: "http://127.0.0.1:8787/",
			publicUrl: "http://127.0.0.1:8787",
			inviteUrl: "http://127.0.0.1:8787",
			startedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}));

		const exitCode = await runDashboardCommand({
			action: "restart",
			io: {
				writeln: () => {},
				writeErr: () => {},
			},
			stopDashboard,
			ensureDashboard,
			openUrl: async () => {},
		});

		expect(exitCode).toBe(0);
		expect(stopDashboard).toHaveBeenCalledTimes(1);
		expect(ensureDashboard).toHaveBeenCalledTimes(1);
		expect(stopDashboard.mock.invocationCallOrder[0]).toBeLessThan(
			ensureDashboard.mock.invocationCallOrder[0],
		);
	});

	it("finds webview assets from the published wrapper package layout", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-wrapper-layout-"));
		const wrapperPath = join(root, "node_modules", "cline", "bin", "cline");
		const platformName = platform() === "win32" ? "windows" : platform();
		const webviewDistDir = join(
			root,
			"node_modules",
			"cline",
			"node_modules",
			"@cline",
			`cli-${platformName}-${arch()}`,
			"cline-hub",
			"webview",
		);
		mkdirSync(join(wrapperPath, ".."), { recursive: true });
		mkdirSync(webviewDistDir, { recursive: true });
		process.env.CLINE_WRAPPER_PATH = wrapperPath;
		delete process.env.CLINE_HUB_WEBVIEW_DIST_DIR;
		let observedWebviewDistDir: string | undefined;

		const exitCode = await runDashboardCommand({
			action: "serve",
			openBrowser: false,
			io: {
				writeln: () => {},
				writeErr: () => {},
			},
			startServer: async () => {
				observedWebviewDistDir = process.env.CLINE_HUB_WEBVIEW_DIST_DIR;
				return {
					listenUrl: "http://127.0.0.1:8787/",
					publicUrl: "http://127.0.0.1:8787",
					inviteUrl: "http://127.0.0.1:8787",
					stop: vi.fn(),
				};
			},
			waitForShutdown: async () => {},
		});

		expect(exitCode).toBe(0);
		expect(observedWebviewDistDir).toBe(webviewDistDir);
	});

	it("settles shutdown when server stop rejects", async () => {
		const shutdown = waitForProcessShutdown({
			listenUrl: "http://127.0.0.1:8787/",
			publicUrl: "http://127.0.0.1:8787",
			inviteUrl: "http://127.0.0.1:8787",
			stop: vi.fn(async () => {
				throw new Error("stop failed");
			}),
		});

		process.emit("SIGINT", "SIGINT");

		await expect(shutdown).rejects.toThrow("stop failed");
	});
});
