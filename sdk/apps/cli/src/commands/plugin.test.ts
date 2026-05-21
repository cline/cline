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
	parsePluginSource,
	runPluginInstallCommand,
} from "./plugin";

type FetchCall = (
	...args: Parameters<typeof fetch>
) => ReturnType<typeof fetch>;

describe("plugin install command", () => {
	let root = "";
	let home = "";
	let workspace = "";
	let originalHome: string | undefined;
	let originalClineDir: string | undefined;
	let originalClineDataDir: string | undefined;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "cli-plugin-install-"));
		home = join(root, "home");
		workspace = join(root, "workspace");
		originalHome = process.env.HOME;
		originalClineDir = process.env.CLINE_DIR;
		originalClineDataDir = process.env.CLINE_DATA_DIR;
		process.env.HOME = home;
		process.env.CLINE_DIR = join(home, ".cline");
		process.env.CLINE_DATA_DIR = join(home, ".cline", "data");
		setHomeDir(home);
		setClineDir(process.env.CLINE_DIR);
	});

	afterEach(() => {
		vi.useRealTimers();
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
		rmSync(root, { recursive: true, force: true });
	});

	it("parses explicit npm source type without the npm prefix", () => {
		expect(parsePluginSource("@scope/plugin@1.2.3", "npm")).toEqual({
			type: "npm",
			spec: "@scope/plugin@1.2.3",
			name: "@scope/plugin",
		});
	});

	it("parses explicit git source type without the git prefix", () => {
		expect(parsePluginSource("github.com/acme/plugin", "git")).toMatchObject({
			type: "git",
			repo: "https://github.com/acme/plugin",
			host: "github.com",
			path: "acme/plugin",
		});
	});

	it("rejects hostname-style sources without --git guidance", () => {
		expect(() => parsePluginSource("github.com/acme/plugin")).toThrow(
			/Use --git/,
		);
	});

	it("parses GitHub plugin file URLs as remote sources", () => {
		expect(
			parsePluginSource(
				"https://github.com/cline/cline/blob/main/sdk/examples/plugins/weather-metrics.ts",
			),
		).toEqual({
			type: "remote",
			url: "https://raw.githubusercontent.com/cline/cline/main/sdk/examples/plugins/weather-metrics.ts",
			filename: "weather-metrics.ts",
		});
	});

	it("parses raw plugin file URLs as remote sources", () => {
		expect(
			parsePluginSource(
				"https://raw.githubusercontent.com/cline/cline/main/sdk/examples/plugins/weather-metrics.ts",
			),
		).toEqual({
			type: "remote",
			url: "https://raw.githubusercontent.com/cline/cline/main/sdk/examples/plugins/weather-metrics.ts",
			filename: "weather-metrics.ts",
		});
	});

	it("rejects HTTP plugin file URLs", () => {
		expect(() =>
			parsePluginSource("http://example.com/plugins/weather-metrics.ts"),
		).toThrow(/must use https/);
	});

	it("installs a local plugin file into the global plugin root", async () => {
		const source = join(root, "weather.ts");
		writeFileSync(
			source,
			"export const plugin = { name: 'weather', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);

		const result = await installPlugin({ source });

		expect(result.installPath).toContain(join(home, ".cline", "plugins"));
		expect(result.entryPaths).toHaveLength(1);
		expect(existsSync(result.entryPaths[0] ?? "")).toBe(true);
		const discovered = discoverPluginModulePaths(
			join(home, ".cline", "plugins"),
		);
		expect(discovered).toEqual(result.entryPaths);
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
		expect(existsSync(result.entryPaths[0] ?? "")).toBe(true);
		expect(readFileSync(result.entryPaths[0] ?? "", "utf8")).toContain(
			"remote-weather",
		);
		expect(
			discoverPluginModulePaths(join(workspace, ".cline", "plugins")),
		).toEqual(result.entryPaths);
	});

	it("times out stalled remote plugin downloads", async () => {
		vi.useFakeTimers();
		const source =
			"https://github.com/acme/plugins/blob/main/weather-metrics.ts";
		const fetchMock = vi.fn<FetchCall>((_input, init) => {
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => {
					const error = new Error("Aborted");
					error.name = "AbortError";
					reject(error);
				});
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		const install = installPlugin({ source, cwd: workspace });
		const rejection = expect(install).rejects.toThrow(/Timed out downloading/);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		await vi.advanceTimersByTimeAsync(30_000);

		await rejection;
	});

	it("rejects remote plugin files with oversized content length", async () => {
		const source =
			"https://github.com/acme/plugins/blob/main/weather-metrics.ts";
		const fetchMock = vi.fn<FetchCall>(async () => {
			return new Response(
				"export default { name: 'remote-weather', manifest: { capabilities: ['tools'] } };",
				{
					headers: {
						"content-length": String(10 * 1024 * 1024 + 1),
					},
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(installPlugin({ source, cwd: workspace })).rejects.toThrow(
			/exceeds the 10485760 byte limit/,
		);
	});

	it("rejects remote plugin files that stream past the size limit", async () => {
		const source =
			"https://github.com/acme/plugins/blob/main/weather-metrics.ts";
		const fetchMock = vi.fn<FetchCall>(async () => {
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1));
						controller.close();
					},
				}),
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(installPlugin({ source, cwd: workspace })).rejects.toThrow(
			/exceeds the 10485760 byte limit/,
		);
	});

	it("installs into cwd plugin root when cwd is provided", async () => {
		const source = join(root, "plugin-package");
		const npmLogPath = join(root, "npm-install.log");
		const npmCommandPath = join(root, "fake-npm.sh");
		writeFileSync(
			npmCommandPath,
			`#!/bin/sh\nprintf '%s\\n' "$PWD $*" >> "${npmLogPath}"\nexit 0\n`,
			{ encoding: "utf8", mode: 0o755 },
		);
		await mkdir(join(source, "node_modules", "dependency"), {
			recursive: true,
		});
		await writeFile(
			join(source, "package.json"),
			JSON.stringify(
				{
					name: "plugin-package",
					cline: {
						plugins: [{ paths: ["./index.ts"], capabilities: ["tools"] }],
					},
					dependencies: {
						"@cline/core": "latest",
						yaml: "^2.8.1",
					},
					peerDependencies: {
						"@cline/shared": "*",
					},
					peerDependenciesMeta: {
						"@cline/shared": {
							optional: true,
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);
		await writeFile(
			join(source, "index.ts"),
			"export default { name: 'plugin-package', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);
		await writeFile(
			join(source, "node_modules", "dependency", "noise.ts"),
			"export default { name: 'noise', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);
		await mkdir(join(source, ".git", "objects"), { recursive: true });
		await writeFile(join(source, ".git", "HEAD"), "ref: refs/heads/main\n");

		const result = await installPlugin({
			source,
			cwd: workspace,
			npmCommand: npmCommandPath,
		});

		const wrapperManifest = JSON.parse(
			readFileSync(join(result.installPath, "package.json"), "utf8"),
		) as { cline?: { plugins?: Array<{ paths?: string[] }> } };
		expect(wrapperManifest.cline?.plugins?.[0]?.paths).toHaveLength(1);
		expect(wrapperManifest.cline?.plugins?.[0]?.paths?.[0]).toContain(
			"package/index.ts",
		);
		const packageManifest = JSON.parse(
			readFileSync(join(result.installPath, "package", "package.json"), "utf8"),
		) as {
			dependencies?: Record<string, string>;
			peerDependencies?: Record<string, string>;
			peerDependenciesMeta?: Record<string, unknown>;
		};
		expect(packageManifest.dependencies).toEqual({ yaml: "^2.8.1" });
		expect(packageManifest.peerDependencies).toBeUndefined();
		expect(packageManifest.peerDependenciesMeta).toBeUndefined();
		const npmLog = readFileSync(npmLogPath, "utf8");
		expect(npmLog).toContain(`${join(".tmp")}/`);
		expect(npmLog).toContain(
			"package install --omit=dev --no-audit --no-fund --package-lock=false",
		);
		expect(existsSync(join(result.installPath, "package", ".git"))).toBe(false);
		expect(
			existsSync(join(result.installPath, "package", "node_modules")),
		).toBe(false);
		const discovered = discoverPluginModulePaths(
			join(workspace, ".cline", "plugins"),
		);
		expect(discovered).toEqual(result.entryPaths);
		expect(discovered.some((path) => path.includes("noise.ts"))).toBe(false);
	});

	it("omits and removes host SDK packages from npm-sourced installs", async () => {
		const npmLogPath = join(root, "npm-source-install.log");
		const npmCommandPath = join(root, "fake-npm-source.sh");
		writeFileSync(
			npmCommandPath,
			[
				"#!/bin/sh",
				`printf '%s\\n' "$*" >> "${npmLogPath}"`,
				"prefix=''",
				"while [ $# -gt 0 ]; do",
				"  if [ \"$1\" = '--prefix' ]; then",
				"    shift",
				'    prefix="$1"',
				"  fi",
				"  shift",
				"done",
				'mkdir -p "$prefix/node_modules/published-plugin"',
				'mkdir -p "$prefix/node_modules/@cline/core"',
				'printf \'%s\\n\' \'{"name":"published-plugin","type":"module","cline":{"plugins":["index.ts"]}}\' > "$prefix/node_modules/published-plugin/package.json"',
				"printf '%s\\n' \"export default { name: 'published-plugin', manifest: { capabilities: ['tools'] } };\" > \"$prefix/node_modules/published-plugin/index.ts\"",
				'printf \'%s\\n\' \'{"name":"@cline/core"}\' > "$prefix/node_modules/@cline/core/package.json"',
				"exit 0",
			].join("\n"),
			{ encoding: "utf8", mode: 0o755 },
		);

		const result = await installPlugin({
			source: "npm:published-plugin@1.0.0",
			npmCommand: npmCommandPath,
		});

		const npmLog = readFileSync(npmLogPath, "utf8");
		expect(npmLog).toContain("install published-plugin@1.0.0");
		expect(npmLog).toContain("--omit=peer");
		expect(
			existsSync(
				join(result.installPath, "package", "node_modules", "@cline", "core"),
			),
		).toBe(false);
		expect(existsSync(result.entryPaths[0] ?? "")).toBe(true);
	});

	it("requires --force before replacing an existing install", async () => {
		const source = join(root, "replace.ts");
		writeFileSync(
			source,
			"export default { name: 'replace', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);

		const first = await installPlugin({ source });
		await expect(installPlugin({ source })).rejects.toThrow(/Use --force/);
		const second = await installPlugin({ source, force: true });

		expect(second.installPath).toBe(first.installPath);
	});

	it("keeps an existing install when a forced replacement fails during staging", async () => {
		const source = join(root, "replace-package");
		const npmCommandPath = join(root, "fake-npm.sh");
		await mkdir(source, { recursive: true });
		await writeFile(
			join(source, "package.json"),
			JSON.stringify(
				{
					name: "replace-package",
					cline: {
						plugins: [{ paths: ["./index.ts"], capabilities: ["tools"] }],
					},
				},
				null,
				2,
			),
			"utf8",
		);
		await writeFile(
			join(source, "index.ts"),
			"export default { name: 'installed-v1', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);
		writeFileSync(npmCommandPath, "#!/bin/sh\nexit 0\n", {
			encoding: "utf8",
			mode: 0o755,
		});

		const first = await installPlugin({ source, npmCommand: npmCommandPath });
		await writeFile(
			join(source, "index.ts"),
			"export default { name: 'installed-v2', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);
		writeFileSync(npmCommandPath, "#!/bin/sh\nprintf 'offline' >&2\nexit 1\n", {
			encoding: "utf8",
			mode: 0o755,
		});

		await expect(
			installPlugin({ source, force: true, npmCommand: npmCommandPath }),
		).rejects.toThrow(/offline/);

		expect(existsSync(first.installPath)).toBe(true);
		expect(
			readFileSync(join(first.installPath, "package", "index.ts"), "utf8"),
		).toContain("installed-v1");
	});

	it("prints JSON output for command callers", async () => {
		const source = join(root, "json.ts");
		writeFileSync(
			source,
			"export default { name: 'json', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);
		const stdout: string[] = [];
		const originalWrite = process.stdout.write;
		process.stdout.write = ((chunk: string | Uint8Array) => {
			stdout.push(String(chunk));
			return true;
		}) as typeof process.stdout.write;
		try {
			const code = await runPluginInstallCommand({
				source,
				json: true,
				io: {
					writeln: () => {},
					writeErr: () => {},
				},
			});
			expect(code).toBe(0);
			const parsed = JSON.parse(stdout.join("")) as { installPath: string };
			expect(parsed.installPath).toContain(join(home, ".cline", "plugins"));
		} finally {
			process.stdout.write = originalWrite;
		}
	});

	it("uses shared search paths for cwd installs", async () => {
		const source = join(root, "workspace.ts");
		writeFileSync(
			source,
			"export default { name: 'workspace', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);

		await installPlugin({
			source,
			cwd: workspace,
		});

		expect(resolvePluginConfigSearchPaths(workspace)[0]).toBe(
			join(workspace, ".cline", "plugins"),
		);
		expect(
			discoverPluginModulePaths(join(workspace, ".cline", "plugins")),
		).toHaveLength(1);
	});
});
