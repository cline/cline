import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	discoverPluginModulePaths,
	resolvePluginConfigSearchPaths,
	setClineDir,
	setHomeDir,
} from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	installPlugin,
	isOfficialPluginSlug,
	parsePluginSource,
} from "./plugin-install";

type FetchCall = (
	...args: Parameters<typeof fetch>
) => ReturnType<typeof fetch>;

describe("plugin install service", () => {
	let root = "";
	let home = "";
	let workspace = "";
	let originalHome: string | undefined;
	let originalClineDir: string | undefined;
	let originalClineDataDir: string | undefined;
	let originalMcpSettingsPath: string | undefined;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "core-plugin-install-"));
		home = join(root, "home");
		workspace = join(root, "workspace");
		originalHome = process.env.HOME;
		originalClineDir = process.env.CLINE_DIR;
		originalClineDataDir = process.env.CLINE_DATA_DIR;
		originalMcpSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
		process.env.HOME = home;
		process.env.CLINE_DIR = join(home, ".cline");
		process.env.CLINE_DATA_DIR = join(home, ".cline", "data");
		process.env.CLINE_MCP_SETTINGS_PATH = join(
			home,
			".cline",
			"cline_mcp_settings.json",
		);
		setHomeDir(home);
		setClineDir(process.env.CLINE_DIR);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
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
		if (originalMcpSettingsPath === undefined) {
			delete process.env.CLINE_MCP_SETTINGS_PATH;
		} else {
			process.env.CLINE_MCP_SETTINGS_PATH = originalMcpSettingsPath;
		}
		rmSync(root, { recursive: true, force: true });
	});

	function runGitCommand(cwd: string, args: string[]): void {
		execFileSync("git", args, { cwd, stdio: "ignore" });
	}

	async function createOfficialPluginsRepo(
		plugins: Record<string, Record<string, string>>,
	): Promise<string> {
		const repo = mkdtempSync(join(root, "official-plugins-"));
		for (const [slug, files] of Object.entries(plugins)) {
			const pluginRoot = join(repo, "plugins", slug);
			await mkdir(pluginRoot, { recursive: true });
			for (const [filename, content] of Object.entries(files)) {
				await writeFile(join(pluginRoot, filename), content, "utf8");
			}
		}
		runGitCommand(repo, ["init"]);
		runGitCommand(repo, ["config", "user.email", "test@example.com"]);
		runGitCommand(repo, ["config", "user.name", "Cline Test"]);
		runGitCommand(repo, ["add", "."]);
		runGitCommand(repo, ["commit", "-m", "seed plugins"]);
		return repo;
	}

	it("parses marketplace plugin sources the same way the CLI command expects", () => {
		expect(isOfficialPluginSlug("web-search")).toBe(true);
		expect(parsePluginSource("web-search")).toEqual({
			type: "official",
			slug: "web-search",
		});
		expect(parsePluginSource("web-search", "npm")).toEqual({
			type: "npm",
			spec: "web-search",
			name: "web-search",
		});
		expect(parsePluginSource("github.com/acme/plugin", "git")).toMatchObject({
			type: "git",
			repo: "https://github.com/acme/plugin",
			host: "github.com",
			path: "acme/plugin",
		});
		expect(() => parsePluginSource("github.com/acme/plugin")).toThrow(
			/Use --git/,
		);
	});

	it("installs a local plugin file into the global plugin root", async () => {
		const source = join(root, "weather.ts");
		writeFileSync(
			source,
			"export default { name: 'weather', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);

		const result = await installPlugin({ source });

		expect(result.installPath).toContain(join(home, ".cline", "plugins"));
		expect(result.entryPaths).toHaveLength(1);
		expect(existsSync(result.entryPaths[0] ?? "")).toBe(true);
		expect(discoverPluginModulePaths(join(home, ".cline", "plugins"))).toEqual(
			result.entryPaths,
		);
	});

	it("installs a remote plugin file into the workspace plugin root", async () => {
		const source =
			"https://github.com/acme/plugins/blob/main/weather-metrics.ts";
		const fetchMock = vi.fn<FetchCall>(async (input) => {
			expect(String(input)).toBe(
				"https://raw.githubusercontent.com/acme/plugins/main/weather-metrics.ts",
			);
			return new Response(
				"export default { name: 'remote-weather', manifest: { capabilities: ['tools'] } };",
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await installPlugin({ source, cwd: workspace });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result.installPath).toContain(
			join(workspace, ".cline", "plugins", "_installed", "remote"),
		);
		expect(result.entryPaths).toHaveLength(1);
		expect(readFileSync(result.entryPaths[0] ?? "", "utf8")).toContain(
			"remote-weather",
		);
		expect(
			discoverPluginModulePaths(join(workspace, ".cline", "plugins")),
		).toEqual(result.entryPaths);
	});

	it("installs an official plugin slug from the configured collection repo", async () => {
		const officialPluginsRepo = await createOfficialPluginsRepo({
			"web-search": {
				"index.ts":
					"export default { name: 'official-web-search', manifest: { capabilities: ['tools'] } };",
			},
			"other-plugin": {
				"index.ts":
					"export default { name: 'other-plugin', manifest: { capabilities: ['tools'] } };",
			},
		});

		const result = await installPlugin({
			source: "web-search",
			cwd: workspace,
			officialPluginsRepo,
		});

		expect(result.installPath).toContain(
			join(workspace, ".cline", "plugins", "_installed", "official"),
		);
		expect(result.entryPaths).toHaveLength(1);
		expect(readFileSync(result.entryPaths[0] ?? "", "utf8")).toContain(
			"official-web-search",
		);
		const wrapperManifest = JSON.parse(
			readFileSync(join(result.installPath, "package.json"), "utf8"),
		) as { name?: string };
		expect(wrapperManifest.name).toBe("web-search");
		expect(existsSync(join(result.installPath, "repo"))).toBe(false);
		expect(
			existsSync(join(result.installPath, "package", "other-plugin")),
		).toBe(false);
		expect(resolvePluginConfigSearchPaths(workspace)[0]).toBe(
			join(workspace, ".cline", "plugins"),
		);
	});

	it("syncs MCP servers declared by installed plugins", async () => {
		const source = join(root, "mcp-plugin.ts");
		writeFileSync(
			source,
			`
export default {
  name: "sdk-mcp-plugin",
  manifest: { capabilities: ["mcp"] },
  setup(api) {
    api.registerMcpServer({
      name: "sdk-docs",
      transport: { type: "streamableHttp", url: "https://example.com/mcp" },
    })
  },
}
`,
			"utf8",
		);

		const result = await installPlugin({ source });

		expect(result.mcpSyncFailures).toEqual([]);
		expect(result.mcpOAuthCandidates).toEqual([
			expect.objectContaining({
				name: "sdk-docs",
				pluginName: "sdk-mcp-plugin",
				pluginPath: result.entryPaths[0],
				transportType: "streamableHttp",
			}),
		]);
		const settings = JSON.parse(
			readFileSync(process.env.CLINE_MCP_SETTINGS_PATH ?? "", "utf8"),
		) as {
			mcpServers?: Record<
				string,
				{ metadata?: Record<string, unknown>; transport?: unknown }
			>;
		};
		expect(settings.mcpServers?.["sdk-docs"]).toMatchObject({
			transport: {
				type: "streamableHttp",
				url: "https://example.com/mcp",
			},
			metadata: {
				source: "plugin",
				pluginName: "sdk-mcp-plugin",
				pluginPath: result.entryPaths[0],
			},
		});
	});

	it("requires force before replacing an existing install", async () => {
		const source = join(root, "replaceable.ts");
		writeFileSync(
			source,
			"export default { name: 'replaceable', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);

		const first = await installPlugin({ source });
		await expect(installPlugin({ source })).rejects.toThrow(/Use --force/);
		const second = await installPlugin({ source, force: true });

		expect(second.installPath).toBe(first.installPath);
		expect(existsSync(second.entryPaths[0] ?? "")).toBe(true);
	});
});
