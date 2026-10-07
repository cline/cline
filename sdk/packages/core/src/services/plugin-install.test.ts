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
	resolveOfficialPluginsArchiveUrl,
	resolvePluginPackageManager,
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

	/** A local checkout of the collection; copied without git. */
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
		return repo;
	}

	/** The same collection as GitHub's codeload tarball, served by a fetch stub. */
	async function stubOfficialPluginsArchive(
		plugins: Record<string, Record<string, string>>,
	): Promise<ReturnType<typeof vi.fn<FetchCall>>> {
		const parent = mkdtempSync(join(root, "archive-src-"));
		for (const [slug, files] of Object.entries(plugins)) {
			const pluginRoot = join(parent, "plugins-HEAD", "plugins", slug);
			await mkdir(pluginRoot, { recursive: true });
			for (const [filename, content] of Object.entries(files)) {
				await writeFile(join(pluginRoot, filename), content, "utf8");
			}
		}
		const archivePath = join(root, "plugins-HEAD.tar.gz");
		execFileSync("tar", ["-czf", archivePath, "-C", parent, "plugins-HEAD"]);
		const fetchMock = vi.fn<FetchCall>(async (input) => {
			expect(String(input)).toBe(
				"https://codeload.github.com/cline/plugins/tar.gz/HEAD",
			);
			return new Response(readFileSync(archivePath), {
				headers: { "content-type": "application/x-gzip" },
			});
		});
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
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

	it("installs an official plugin from the GitHub tarball without git", async () => {
		const fetchMock = await stubOfficialPluginsArchive({
			"web-search": {
				"index.ts":
					"export default { name: 'tarball-web-search', manifest: { capabilities: ['tools'] } };",
			},
			"other-plugin": {
				"index.ts":
					"export default { name: 'other-plugin', manifest: { capabilities: ['tools'] } };",
			},
		});

		const result = await installPlugin({
			source: "web-search",
			cwd: workspace,
			officialPluginsRepo: "https://github.com/cline/plugins.git",
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result.installPath).toContain(
			join(workspace, ".cline", "plugins", "_installed", "official"),
		);
		expect(readFileSync(result.entryPaths[0] ?? "", "utf8")).toContain(
			"tarball-web-search",
		);
		expect(existsSync(join(result.installPath, "repo"))).toBe(false);
		expect(
			existsSync(join(result.installPath, "package", "other-plugin")),
		).toBe(false);
	});

	it("reports a missing slug from the GitHub tarball", async () => {
		await stubOfficialPluginsArchive({
			"web-search": { "index.ts": "export default { name: 'x' };" },
		});
		await expect(
			installPlugin({
				source: "does-not-exist",
				cwd: workspace,
				officialPluginsRepo: "https://github.com/cline/plugins",
			}),
		).rejects.toThrow(
			/"does-not-exist" was not found at plugins\/does-not-exist/,
		);
	});

	it("maps GitHub collection URLs to codeload tarballs and leaves other hosts to git", () => {
		expect(
			resolveOfficialPluginsArchiveUrl("https://github.com/cline/plugins.git"),
		).toBe("https://codeload.github.com/cline/plugins/tar.gz/HEAD");
		expect(
			resolveOfficialPluginsArchiveUrl("https://github.com/acme/collection/"),
		).toBe("https://codeload.github.com/acme/collection/tar.gz/HEAD");
		expect(
			resolveOfficialPluginsArchiveUrl(
				"https://gitlab.com/acme/collection.git",
			),
		).toBeUndefined();
		expect(resolveOfficialPluginsArchiveUrl("/tmp/collection")).toBeUndefined();
	});

	it("installs an official plugin that depends only on @cline/* without a package manager", async () => {
		const officialPluginsRepo = await createOfficialPluginsRepo({
			linear: {
				"package.json": JSON.stringify({
					name: "linear",
					cline: { plugins: ["./index.ts"] },
					peerDependencies: { "@cline/core": "*" },
					optionalDependencies: { "@cline/shared": "*" },
					devDependencies: { typescript: "^5" },
				}),
				"index.ts":
					"export default { name: 'official-linear', manifest: { capabilities: ['tools'] } };",
			},
		});

		const result = await installPlugin({
			source: "linear",
			cwd: workspace,
			officialPluginsRepo,
			// Would fail with ENOENT if the installer still shelled out.
			npmCommand: join(root, "no-such-package-manager"),
		});

		expect(readFileSync(result.entryPaths[0] ?? "", "utf8")).toContain(
			"official-linear",
		);
		const manifest = JSON.parse(
			readFileSync(join(result.installPath, "package", "package.json"), "utf8"),
		) as Record<string, unknown>;
		expect(manifest.optionalDependencies).toBeUndefined();
		expect(manifest.peerDependencies).toBeUndefined();
	});

	it("still runs the package manager when third-party dependencies remain", async () => {
		const officialPluginsRepo = await createOfficialPluginsRepo({
			"agents-squad": {
				"package.json": JSON.stringify({
					name: "agents-squad",
					cline: { plugins: ["./index.ts"] },
					dependencies: { "@cline/core": "*", yaml: "^2" },
				}),
				"index.ts": "export default { name: 'squad' };",
			},
		});

		await expect(
			installPlugin({
				source: "agents-squad",
				cwd: workspace,
				officialPluginsRepo,
				npmCommand: join(root, "no-such-package-manager"),
			}),
		).rejects.toThrow(/ENOENT/);
	});

	it("uses a compiled Bun host as its own package manager", () => {
		const realExecPath = process.execPath;
		const previousCommand = process.env.CLINE_NPM_COMMAND;
		delete process.env.CLINE_NPM_COMMAND;
		vi.stubGlobal("Bun", (globalThis as { Bun?: unknown }).Bun ?? {});
		process.execPath = "/Applications/Cline.app/Contents/MacOS/code-sidecar";
		try {
			expect(resolvePluginPackageManager()).toEqual({
				command: process.execPath,
				kind: "bun",
			});
			expect(resolvePluginPackageManager("pnpm")).toEqual({
				command: "pnpm",
				kind: "npm",
			});
			process.env.CLINE_NPM_COMMAND = "/opt/npm";
			expect(resolvePluginPackageManager()).toEqual({
				command: "/opt/npm",
				kind: "npm",
			});
			delete process.env.CLINE_NPM_COMMAND;
			process.execPath = "/usr/local/bin/node";
			expect(resolvePluginPackageManager()).toEqual({
				command: "npm",
				kind: "npm",
			});
		} finally {
			process.execPath = realExecPath;
			if (previousCommand === undefined) {
				delete process.env.CLINE_NPM_COMMAND;
			} else {
				process.env.CLINE_NPM_COMMAND = previousCommand;
			}
		}
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
