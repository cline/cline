import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setClineDir, setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readGlobalSettings, writeGlobalSettings } from "./global-settings";
import { uninstallPlugin } from "./plugin-uninstall";

describe("plugin uninstall service", () => {
	let root = "";
	let home = "";
	let originalHome: string | undefined;
	let originalClineDir: string | undefined;
	let originalClineDataDir: string | undefined;
	let originalGlobalSettingsPath: string | undefined;
	let originalMcpSettingsPath: string | undefined;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "core-plugin-uninstall-"));
		home = join(root, "home");
		originalHome = process.env.HOME;
		originalClineDir = process.env.CLINE_DIR;
		originalClineDataDir = process.env.CLINE_DATA_DIR;
		originalGlobalSettingsPath = process.env.CLINE_GLOBAL_SETTINGS_PATH;
		originalMcpSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
		process.env.HOME = home;
		process.env.CLINE_DIR = join(home, ".cline");
		process.env.CLINE_DATA_DIR = join(home, ".cline", "data");
		process.env.CLINE_GLOBAL_SETTINGS_PATH = join(
			home,
			".cline",
			"data",
			"settings",
			"global-settings.json",
		);
		setHomeDir(home);
		setClineDir(process.env.CLINE_DIR);
	});

	afterEach(() => {
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		if (originalClineDir === undefined) {
			delete process.env.CLINE_DIR;
		} else {
			process.env.CLINE_DIR = originalClineDir;
		}
		if (originalClineDataDir === undefined) {
			delete process.env.CLINE_DATA_DIR;
		} else {
			process.env.CLINE_DATA_DIR = originalClineDataDir;
		}
		if (originalGlobalSettingsPath === undefined) {
			delete process.env.CLINE_GLOBAL_SETTINGS_PATH;
		} else {
			process.env.CLINE_GLOBAL_SETTINGS_PATH = originalGlobalSettingsPath;
		}
		if (originalMcpSettingsPath === undefined) {
			delete process.env.CLINE_MCP_SETTINGS_PATH;
		} else {
			process.env.CLINE_MCP_SETTINGS_PATH = originalMcpSettingsPath;
		}
		rmSync(root, { recursive: true, force: true });
	});

	it("uninstalls an installed package plugin by package name", async () => {
		const installPath = join(
			home,
			".cline",
			"plugins",
			"_installed",
			"local",
			"bundled-skills-demo-123456789abc",
		);
		const entryPath = join(installPath, "package", "index.ts");
		await mkdir(join(installPath, "package"), { recursive: true });
		await writeFile(
			join(installPath, "package.json"),
			JSON.stringify(
				{
					name: "cline-installed-plugin-test",
					cline: {
						plugins: [{ paths: ["./package/index.ts"] }],
					},
				},
				null,
				2,
			),
			"utf8",
		);
		await writeFile(
			join(installPath, "package", "package.json"),
			JSON.stringify({ name: "cline-internal-bundled-skills-demo" }, null, 2),
			"utf8",
		);
		await writeFile(
			entryPath,
			"export default { name: 'demo', manifest: { capabilities: ['skills'] } };",
			"utf8",
		);
		writeGlobalSettings({
			disabledPlugins: [entryPath, "/tmp/other-plugin.ts"],
		});

		const result = await uninstallPlugin({
			name: "cline-internal-bundled-skills-demo",
		});

		expect(result.installPath).toBe(installPath);
		expect(existsSync(installPath)).toBe(false);
		expect(readGlobalSettings()).toEqual({
			autoUpdateEnabled: true,
			disabledPlugins: ["/tmp/other-plugin.ts"],
			telemetryOptOut: false,
		});
	});

	it("uninstalls a direct plugin file by path", async () => {
		const pluginPath = join(home, ".cline", "plugins", "direct-plugin.ts");
		await mkdir(join(home, ".cline", "plugins"), { recursive: true });
		await writeFile(
			pluginPath,
			"export default { name: 'direct', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);

		const result = await uninstallPlugin({ path: pluginPath });

		expect(result.installPath).toBe(pluginPath);
		expect(existsSync(pluginPath)).toBe(false);
	});

	it.skipIf(process.platform === "win32")(
		"keeps plugin files when MCP settings cleanup fails",
		async () => {
			const pluginPath = join(home, ".cline", "plugins", "mcp-plugin.ts");
			const settingsPath = join(root, "cline_mcp_settings.json");
			process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
			await mkdir(join(home, ".cline", "plugins"), { recursive: true });
			await writeFile(
				pluginPath,
				"export default { name: 'mcp-plugin', manifest: { capabilities: ['mcp'] } };",
				"utf8",
			);
			await writeFile(
				settingsPath,
				JSON.stringify(
					{
						mcpServers: {
							smoke: {
								transport: {
									type: "stdio",
									command: process.execPath,
									args: ["-e", "process.exit(0)"],
								},
								metadata: {
									source: "plugin",
									pluginName: "mcp-plugin",
									pluginPath,
								},
							},
						},
					},
					null,
					2,
				),
				"utf8",
			);
			chmodSync(settingsPath, 0o444);

			try {
				await expect(uninstallPlugin({ path: pluginPath })).rejects.toThrow();
			} finally {
				chmodSync(settingsPath, 0o644);
			}

			expect(existsSync(pluginPath)).toBe(true);
		},
	);

	// chmod-based deletion failure cannot be simulated on Windows, where read-only
	// directory permissions do not prevent removing files inside them.
	it.skipIf(process.platform === "win32")(
		"keeps disabled plugin settings if file deletion fails",
		async () => {
			const pluginRoot = join(home, ".cline", "plugins");
			const pluginPath = join(pluginRoot, "locked-plugin.ts");
			await mkdir(pluginRoot, { recursive: true });
			await writeFile(
				pluginPath,
				"export default { name: 'locked', manifest: { capabilities: ['tools'] } };",
				"utf8",
			);
			writeGlobalSettings({ disabledPlugins: [pluginPath] });
			chmodSync(pluginRoot, 0o555);

			try {
				await expect(uninstallPlugin({ path: pluginPath })).rejects.toThrow();
				expect(existsSync(pluginPath)).toBe(true);
				expect(readGlobalSettings()).toEqual({
					autoUpdateEnabled: true,
					disabledPlugins: [pluginPath],
					telemetryOptOut: false,
				});
			} finally {
				chmodSync(pluginRoot, 0o755);
			}
		},
	);

	it("reports unmatched names clearly", async () => {
		await expect(uninstallPlugin({ name: "missing-plugin" })).rejects.toThrow(
			/No plugin found matching "missing-plugin"/,
		);
	});
});
