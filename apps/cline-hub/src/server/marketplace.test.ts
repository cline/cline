import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildMarketplaceMcpInput,
	fetchMarketplaceCatalog,
	installMarketplaceEntry,
	installMarketplaceEntryForDesktopCommand,
	listMarketplaceInstalledEntries,
	uninstallLocalPrimitive,
	uninstallMarketplaceEntry,
	uninstallMarketplaceEntryForDesktopCommand,
} from "./marketplace";

describe("marketplace installer", () => {
	const originalWrapperPath = process.env.CLINE_WRAPPER_PATH;
	const originalClineDir = process.env.CLINE_DIR;
	const originalHome = process.env.HOME;
	const originalMcpSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;

	afterEach(() => {
		if (originalWrapperPath === undefined) {
			delete process.env.CLINE_WRAPPER_PATH;
		} else {
			process.env.CLINE_WRAPPER_PATH = originalWrapperPath;
		}
		if (originalClineDir === undefined) {
			delete process.env.CLINE_DIR;
		} else {
			process.env.CLINE_DIR = originalClineDir;
		}
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		if (originalMcpSettingsPath === undefined) {
			delete process.env.CLINE_MCP_SETTINGS_PATH;
		} else {
			process.env.CLINE_MCP_SETTINGS_PATH = originalMcpSettingsPath;
		}
		vi.restoreAllMocks();
	});

	it("maps remote MCP catalog args to MCP settings shape", () => {
		expect(
			buildMarketplaceMcpInput([
				"context7",
				"--transport",
				"http",
				"https://mcp.context7.com/mcp",
				"--header",
				"Authorization: Bearer <token>",
			]),
		).toEqual({
			name: "context7",
			transportType: "streamableHttp",
			url: "https://mcp.context7.com/mcp",
			headers: {
				Authorization: "Bearer <token>",
			},
			disabled: false,
		});
	});

	it("maps stdio MCP catalog args to command and args", () => {
		expect(
			buildMarketplaceMcpInput(["filesystem", "npx", "-y", "server", "/tmp"]),
		).toEqual({
			name: "filesystem",
			transportType: "stdio",
			command: "npx",
			args: ["-y", "server", "/tmp"],
			disabled: false,
		});
	});

	it("preserves server flags after stdio MCP command args begin", () => {
		expect(
			buildMarketplaceMcpInput([
				"search",
				"npx",
				"-y",
				"server",
				"--transport",
				"stdio",
			]),
		).toEqual({
			name: "search",
			transportType: "stdio",
			command: "npx",
			args: ["-y", "server", "--transport", "stdio"],
			disabled: false,
		});
	});

	it("runs skills globally for Cline without prompts", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "cline-marketplace-home-"));
		process.env.HOME = homeDir;
		const spawnCommand = vi.fn(async () => {
			mkdirSync(join(homeDir, ".agents", "skills", "web-design-guidelines"), {
				recursive: true,
			});
			writeFileSync(
				join(homeDir, ".agents", "skills", "web-design-guidelines", "SKILL.md"),
				"---\nname: web-design-guidelines\n---\n",
			);
			return {
				exitCode: 0,
				stdout: "installed",
				stderr: "",
			};
		});

		await installMarketplaceEntry(
			{
				entry: {
					id: "web-design-guidelines",
					type: "skill",
					name: "Web Design Guidelines",
					install: {
						args: [
							"vercel-labs/agent-skills",
							"--skill",
							"web-design-guidelines",
						],
					},
				},
			},
			{ spawnCommand },
		);

		expect(spawnCommand).toHaveBeenCalledWith("npx", [
			"-y",
			"skills@latest",
			"add",
			"vercel-labs/agent-skills",
			"--skill",
			"web-design-guidelines",
			"-g",
			"-a",
			"cline",
			"-y",
		]);
	});

	it("skips skill install commands when the global skill already exists", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "cline-marketplace-home-"));
		process.env.HOME = homeDir;
		mkdirSync(join(homeDir, ".agents", "skills", "cline-sdk"), {
			recursive: true,
		});
		writeFileSync(
			join(homeDir, ".agents", "skills", "cline-sdk", "SKILL.md"),
			"---\nname: cline-sdk\n---\n",
		);
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: "",
			stderr: "",
		}));

		await expect(
			installMarketplaceEntry(
				{
					entry: {
						id: "cline-sdk",
						type: "skill",
						name: "Cline SDK",
						install: { args: ["cline/sdk-skill"] },
					},
				},
				{ spawnCommand },
			),
		).resolves.toMatchObject({
			status: "installed",
			message: "Cline SDK is already installed.",
		});
		expect(spawnCommand).not.toHaveBeenCalled();
	});

	it("reports Cline global skills as marketplace-installed", () => {
		const clineDir = mkdtempSync(join(tmpdir(), "cline-marketplace-cline-"));
		process.env.CLINE_DIR = clineDir;
		mkdirSync(join(clineDir, "skills", "cline-sdk"), {
			recursive: true,
		});
		writeFileSync(
			join(clineDir, "skills", "cline-sdk", "SKILL.md"),
			"---\nname: cline-sdk\n---\n",
		);

		expect(
			listMarketplaceInstalledEntries({
				entries: [
					{
						id: "cline-sdk",
						type: "skill",
						name: "Cline SDK",
						install: { args: ["cline/sdk-skill"] },
					},
				],
			}),
		).toEqual({ installedKeys: ["skill:cline-sdk"] });
	});

	it("accepts skill installs that create Cline global skills", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "cline-marketplace-home-"));
		const clineDir = join(homeDir, ".cline");
		process.env.HOME = homeDir;
		process.env.CLINE_DIR = clineDir;
		const spawnCommand = vi.fn(async () => {
			mkdirSync(join(clineDir, "skills", "cline-sdk"), {
				recursive: true,
			});
			writeFileSync(
				join(clineDir, "skills", "cline-sdk", "SKILL.md"),
				"---\nname: cline-sdk\n---\n",
			);
			return {
				exitCode: 0,
				stdout: "installed",
				stderr: "",
			};
		});

		await expect(
			installMarketplaceEntry(
				{
					entry: {
						id: "cline-sdk",
						type: "skill",
						name: "Cline SDK",
						install: { args: ["cline/sdk-skill"] },
					},
				},
				{ spawnCommand },
			),
		).resolves.toMatchObject({
			status: "installed",
			message: "Installed Cline SDK globally for Cline.",
		});
	});

	it("removes Cline global marketplace skills without prompts", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "cline-marketplace-home-"));
		process.env.HOME = homeDir;
		const skillDir = join(homeDir, ".agents", "skills", "cline-sdk");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, "SKILL.md"), "---\nname: cline-sdk\n---\n");
		const spawnCommand = vi.fn(async () => {
			rmSync(skillDir, { recursive: true, force: true });
			return {
				exitCode: 0,
				stdout: "removed",
				stderr: "",
			};
		});

		await expect(
			uninstallMarketplaceEntry(
				{
					entry: {
						id: "cline-sdk",
						type: "skill",
						name: "Cline SDK",
						install: { args: ["cline/sdk-skill"] },
					},
				},
				{ spawnCommand },
			),
		).resolves.toMatchObject({
			status: "uninstalled",
			message: "Uninstalled Cline SDK.",
		});
		expect(spawnCommand).toHaveBeenCalledWith("npx", [
			"-y",
			"skills@latest",
			"remove",
			"cline-sdk",
			"-g",
			"-a",
			"cline",
			"-y",
		]);
	});

	it("does not report project-local skills as marketplace-installed globals", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "cline-marketplace-home-"));
		process.env.HOME = homeDir;

		expect(
			listMarketplaceInstalledEntries(
				{
					entries: [
						{
							id: "cline-sdk",
							type: "skill",
							name: "Cline SDK",
							install: { args: ["cline/sdk-skill"] },
						},
					],
				},
				{
					skills: [
						{
							id: "cline-sdk",
							name: "cline-sdk",
							path: "/workspace/project/.agents/skills/cline-sdk/SKILL.md",
						},
					],
				},
			),
		).toEqual({ installedKeys: [] });
	});

	it("rejects skill installs that exit zero but report failure", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "cline-marketplace-home-"));
		process.env.HOME = homeDir;
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: "Failed to install 1",
			stderr: "",
		}));

		await expect(
			installMarketplaceEntry(
				{
					entry: {
						id: "cline-sdk",
						type: "skill",
						name: "Cline SDK",
						install: { args: ["cline/sdk-skill"] },
					},
				},
				{ spawnCommand },
			),
		).rejects.toThrow("Skill install failed");
	});

	it("redacts common secret formats from failed install output", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "cline-marketplace-home-"));
		process.env.HOME = homeDir;
		const spawnCommand = vi.fn(async () => ({
			exitCode: 1,
			stdout:
				"Authorization: Bearer stdout-token\napi key stdout-key\nOPENAI_API_KEY=compound-key",
			stderr:
				"TOKEN=stderr-token\npassword is stderr-password\nANTHROPIC_SECRET_KEY=anthropic-secret",
		}));

		let message = "";
		try {
			await installMarketplaceEntry(
				{
					entry: {
						id: "cline-sdk",
						type: "skill",
						name: "Cline SDK",
						install: { args: ["cline/sdk-skill"] },
					},
				},
				{ spawnCommand },
			);
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}

		expect(message).toContain("Authorization: Bearer [redacted]");
		expect(message).toContain("api key [redacted]");
		expect(message).toContain("OPENAI_API_KEY=[redacted]");
		expect(message).toContain("TOKEN=[redacted]");
		expect(message).toContain("password is [redacted]");
		expect(message).toContain("ANTHROPIC_SECRET_KEY=[redacted]");
		expect(message).not.toContain("stdout-token");
		expect(message).not.toContain("stdout-key");
		expect(message).not.toContain("compound-key");
		expect(message).not.toContain("stderr-token");
		expect(message).not.toContain("stderr-password");
		expect(message).not.toContain("anthropic-secret");
	});

	it("rejects skill installs before spawning when the global skill directory is not writable", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "cline-marketplace-home-"));
		process.env.HOME = homeDir;
		mkdirSync(join(homeDir, ".agents"), { recursive: true });
		writeFileSync(join(homeDir, ".agents", "skills"), "");
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: "",
			stderr: "",
		}));

		await expect(
			installMarketplaceEntry(
				{
					entry: {
						id: "cline-sdk",
						type: "skill",
						name: "Cline SDK",
						install: { args: ["cline/sdk-skill"] },
					},
				},
				{ spawnCommand },
			),
		).rejects.toThrow(
			"Cannot install skill globally because ~/.agents/skills is not writable",
		);
		expect(spawnCommand).not.toHaveBeenCalled();
	});

	it("rejects skill installs that do not create a global skill", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "cline-marketplace-home-"));
		process.env.HOME = homeDir;
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: "Installation complete",
			stderr: "",
		}));

		await expect(
			installMarketplaceEntry(
				{
					entry: {
						id: "cline-sdk",
						type: "skill",
						name: "Cline SDK",
						install: { args: ["cline/sdk-skill"] },
					},
				},
				{ spawnCommand },
			),
		).rejects.toThrow("was not found in Cline's global skills directories");
	});

	it("runs official plugin installs through the current Cline CLI", async () => {
		process.env.CLINE_WRAPPER_PATH = "/usr/local/bin/cline";
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: JSON.stringify({ installPath: "/tmp/plugin" }),
			stderr: "",
		}));

		await installMarketplaceEntry(
			{
				entry: {
					id: "marketplace-test-plugin",
					type: "plugin",
					name: "Marketplace Test Plugin",
					install: { args: ["marketplace-test-plugin"] },
				},
			},
			{ spawnCommand },
		);

		expect(spawnCommand).toHaveBeenCalledWith("/usr/local/bin/cline", [
			"plugin",
			"install",
			"marketplace-test-plugin",
			"--json",
		]);
	});

	it("runs MCP installs through the current Cline CLI without prompts", async () => {
		process.env.CLINE_WRAPPER_PATH = "/usr/local/bin/cline";
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: JSON.stringify({
				name: "context7",
				status: "installed",
				transport: {
					type: "streamableHttp",
					url: "https://mcp.context7.com/mcp",
					headers: {
						Authorization: "Bearer token",
					},
				},
			}),
			stderr: "",
		}));

		await expect(
			installMarketplaceEntry(
				{
					entry: {
						id: "context7",
						type: "mcp",
						name: "Context7",
						install: {
							args: [
								"context7",
								"--transport",
								"http",
								"https://mcp.context7.com/mcp",
								"--header",
								"Authorization: Bearer token",
							],
						},
					},
				},
				{ spawnCommand },
			),
		).resolves.toMatchObject({
			status: "installed",
			message: "Installed Context7.",
			details: {
				name: "context7",
				status: "installed",
			},
		});

		expect(spawnCommand).toHaveBeenCalledWith("/usr/local/bin/cline", [
			"mcp",
			"install",
			"--yes",
			"--json",
			"context7",
			"--transport",
			"http",
			"https://mcp.context7.com/mcp",
			"--header",
			"Authorization: Bearer token",
		]);
	});

	it("runs official plugin uninstalls through the current Cline CLI", async () => {
		process.env.CLINE_WRAPPER_PATH = "/usr/local/bin/cline";
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: JSON.stringify({
				name: "goal",
				installPath: "/tmp/plugin",
				removedPaths: ["/tmp/plugin"],
				entryPaths: [],
			}),
			stderr: "",
		}));

		await expect(
			uninstallMarketplaceEntry(
				{
					entry: {
						id: "goal",
						type: "plugin",
						name: "Goal",
						install: { args: ["goal"] },
					},
				},
				{ spawnCommand },
			),
		).resolves.toMatchObject({
			status: "uninstalled",
			message: "Uninstalled Goal.",
		});

		expect(spawnCommand).toHaveBeenCalledWith("/usr/local/bin/cline", [
			"plugin",
			"uninstall",
			"goal",
			"--json",
		]);
	});

	it("resolves desktop installs from the server catalog instead of browser-sent args", async () => {
		process.env.CLINE_WRAPPER_PATH = "/usr/local/bin/cline";
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: JSON.stringify({ installPath: "/tmp/plugin" }),
			stderr: "",
		}));

		await installMarketplaceEntryForDesktopCommand(
			{
				entry: {
					id: "marketplace-test-plugin",
					type: "plugin",
					name: "Tampered",
					install: { args: ["malicious-source"] },
				},
			},
			{
				spawnCommand,
				loadCatalog: async () => ({
					entries: [
						{
							id: "marketplace-test-plugin",
							type: "plugin",
							name: "Marketplace Test Plugin",
							install: { args: ["marketplace-test-plugin"] },
						},
					],
				}),
			},
		);

		expect(spawnCommand).toHaveBeenCalledWith("/usr/local/bin/cline", [
			"plugin",
			"install",
			"marketplace-test-plugin",
			"--json",
		]);
	});

	it("resolves desktop uninstalls from the server catalog instead of browser-sent args", async () => {
		process.env.CLINE_WRAPPER_PATH = "/usr/local/bin/cline";
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: JSON.stringify({
				name: "goal",
				installPath: "/tmp/plugin",
				removedPaths: ["/tmp/plugin"],
				entryPaths: [],
			}),
			stderr: "",
		}));

		await uninstallMarketplaceEntryForDesktopCommand(
			{
				entry: {
					id: "goal",
					type: "plugin",
					name: "Tampered",
					install: { args: ["malicious-source"] },
				},
			},
			{
				spawnCommand,
				loadCatalog: async () => ({
					entries: [
						{
							id: "goal",
							type: "plugin",
							name: "Goal",
							install: { args: ["goal"] },
						},
					],
				}),
			},
		);

		expect(spawnCommand).toHaveBeenCalledWith("/usr/local/bin/cline", [
			"plugin",
			"uninstall",
			"goal",
			"--json",
		]);
	});

	it("uninstalls MCP marketplace entries from Cline MCP settings", async () => {
		const settingsPath = join(
			mkdtempSync(join(tmpdir(), "cline-marketplace-mcp-")),
			"cline_mcp_settings.json",
		);
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		writeFileSync(
			settingsPath,
			JSON.stringify(
				{
					mcpServers: {
						context7: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.context7.com/mcp",
							},
						},
					},
				},
				null,
				2,
			),
		);

		await expect(
			uninstallMarketplaceEntry({
				entry: {
					id: "context7",
					type: "mcp",
					name: "Context7",
					install: {
						args: [
							"context7",
							"--transport",
							"http",
							"https://mcp.context7.com/mcp",
						],
					},
				},
			}),
		).resolves.toMatchObject({
			status: "uninstalled",
			message: "Uninstalled Context7.",
		});
		expect(
			listMarketplaceInstalledEntries({
				entries: [
					{
						id: "context7",
						type: "mcp",
						name: "Context7",
						install: {
							args: [
								"context7",
								"--transport",
								"http",
								"https://mcp.context7.com/mcp",
							],
						},
					},
				],
			}),
		).toEqual({ installedKeys: [] });
	});

	it("uninstalls local MCP servers by name", async () => {
		const settingsPath = join(
			mkdtempSync(join(tmpdir(), "cline-local-mcp-")),
			"cline_mcp_settings.json",
		);
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		writeFileSync(
			settingsPath,
			JSON.stringify(
				{
					mcpServers: {
						context7: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.context7.com/mcp",
							},
						},
					},
				},
				null,
				2,
			),
		);

		await expect(
			uninstallLocalPrimitive({
				type: "mcp",
				id: "context7",
				name: "context7",
			}),
		).resolves.toMatchObject({
			status: "uninstalled",
			message: "Uninstalled context7.",
		});
		expect(readFileSync(settingsPath, "utf8")).not.toContain("context7");
	});

	it("uninstalls local skills by removing their configured skill directory", async () => {
		const workspaceRoot = mkdtempSync(join(tmpdir(), "cline-local-skill-"));
		const skillDir = join(workspaceRoot, ".cline", "skills", "review");
		mkdirSync(skillDir, { recursive: true });
		const skillPath = join(skillDir, "SKILL.md");
		writeFileSync(skillPath, "---\nname: review\n---\nReview changes.");

		await expect(
			uninstallLocalPrimitive(
				{
					type: "skill",
					id: "review",
					name: "Review",
					path: skillPath,
				},
				{ workspaceRoot },
			),
		).resolves.toMatchObject({
			status: "uninstalled",
			message: "Uninstalled Review.",
		});
		expect(existsSync(skillDir)).toBe(false);
	});

	it("reports official plugin marketplace entries installed from Cline home", () => {
		const clineDir = mkdtempSync(join(tmpdir(), "cline-marketplace-test-"));
		process.env.CLINE_DIR = clineDir;
		const sourceKey =
			"official:https://github.com/cline/plugins.git#plugins/goal";
		const hash = createHash("sha256")
			.update(sourceKey)
			.digest("hex")
			.slice(0, 12);
		mkdirSync(
			join(clineDir, "plugins", "_installed", "official", `goal-${hash}`),
			{
				recursive: true,
			},
		);

		expect(
			listMarketplaceInstalledEntries({
				entries: [
					{
						id: "goal",
						type: "plugin",
						name: "Goal",
						install: { args: ["goal"] },
					},
				],
			}),
		).toEqual({ installedKeys: ["plugin:goal"] });
	});

	it("does not report plugin inventory substring matches as installed", () => {
		process.env.CLINE_DIR = mkdtempSync(
			join(tmpdir(), "cline-marketplace-test-"),
		);

		expect(
			listMarketplaceInstalledEntries(
				{
					entries: [
						{
							id: "goal",
							type: "plugin",
							name: "Goal",
							install: { args: ["goal"] },
						},
					],
				},
				{
					plugins: [
						{
							name: "goal-helper",
							path: "/workspace/.cline/plugins/goal-helper/index.ts",
						},
					],
				},
			),
		).toEqual({ installedKeys: [] });
	});

	it("skips invalid marketplace entries during installed-status checks", () => {
		const clineDir = mkdtempSync(join(tmpdir(), "cline-marketplace-test-"));
		process.env.CLINE_DIR = clineDir;
		const sourceKey =
			"official:https://github.com/cline/plugins.git#plugins/goal";
		const hash = createHash("sha256")
			.update(sourceKey)
			.digest("hex")
			.slice(0, 12);
		mkdirSync(
			join(clineDir, "plugins", "_installed", "official", `goal-${hash}`),
			{
				recursive: true,
			},
		);

		expect(
			listMarketplaceInstalledEntries({
				entries: [
					{
						id: "broken-mcp",
						type: "mcp",
						name: "Broken MCP",
						install: {
							args: [
								"broken-mcp",
								"--transport",
								"ws",
								"https://example.com/mcp",
							],
						},
					},
					{
						id: "goal",
						type: "plugin",
						name: "Goal",
						install: { args: ["goal"] },
					},
				],
			}),
		).toEqual({ installedKeys: ["plugin:goal"] });
	});

	it("rejects invalid marketplace entries before spawning commands", async () => {
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: "",
			stderr: "",
		}));

		await expect(
			installMarketplaceEntry(
				{
					entry: {
						id: "bad",
						type: "skill",
						install: { args: [] },
					},
				},
				{ spawnCommand },
			),
		).rejects.toThrow("marketplace install args are required");
		expect(spawnCommand).not.toHaveBeenCalled();
	});

	it("fetches the marketplace catalog through the server helper", async () => {
		const fetchImpl = vi.fn(async () => {
			return new Response(JSON.stringify({ version: 1, entries: [] }), {
				headers: { "content-type": "application/json" },
			});
		});

		await expect(fetchMarketplaceCatalog(fetchImpl)).resolves.toEqual({
			version: 1,
			entries: [],
		});
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://cline.github.io/marketplace/catalog.json",
			{ headers: { Accept: "application/json" } },
		);
	});

	it("surfaces marketplace catalog upstream failures", async () => {
		const fetchImpl = vi.fn(async () => {
			return new Response("nope", {
				status: 503,
				statusText: "Service Unavailable",
			});
		});

		await expect(fetchMarketplaceCatalog(fetchImpl)).rejects.toThrow(
			"Failed to fetch marketplace catalog: 503 Service Unavailable",
		);
	});
});
