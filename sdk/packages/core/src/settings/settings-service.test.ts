import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setHomeDir } from "@cline/shared/storage";
import { afterEach, describe, expect, it } from "vitest";
import type { UserInstructionConfigService } from "../extensions/config";
import { listPluginToolsWithDiagnostics } from "../services/plugin-tools";
import { CoreSettingsService } from "./settings-service";

describe("CoreSettingsService", () => {
	const tempRoots: string[] = [];
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_GLOBAL_SETTINGS_PATH: process.env.CLINE_GLOBAL_SETTINGS_PATH,
		CLINE_MCP_SETTINGS_PATH: process.env.CLINE_MCP_SETTINGS_PATH,
	};

	afterEach(async () => {
		process.env.HOME = envSnapshot.HOME;
		setHomeDir(envSnapshot.HOME ?? "~");
		if (envSnapshot.CLINE_GLOBAL_SETTINGS_PATH === undefined) {
			delete process.env.CLINE_GLOBAL_SETTINGS_PATH;
		} else {
			process.env.CLINE_GLOBAL_SETTINGS_PATH =
				envSnapshot.CLINE_GLOBAL_SETTINGS_PATH;
		}
		if (envSnapshot.CLINE_MCP_SETTINGS_PATH === undefined) {
			delete process.env.CLINE_MCP_SETTINGS_PATH;
		} else {
			process.env.CLINE_MCP_SETTINGS_PATH = envSnapshot.CLINE_MCP_SETTINGS_PATH;
		}
		await Promise.all(
			tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempRoots.length = 0;
	});

	it("toggles skill frontmatter and refreshes the skill service before returning a snapshot", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-settings-"));
		tempRoots.push(tempRoot);
		const skillPath = join(tempRoot, "SKILL.md");
		await writeFile(
			skillPath,
			`---
name: skill-one
---
Use this skill.`,
		);

		const calls: string[] = [];
		let refreshed = false;
		const userInstructionService = {
			async refreshType(type: string) {
				calls.push(`refreshType:${type}`);
				refreshed = true;
			},
			listRecords(type: string) {
				calls.push(`listRecords:${type}`);
				if (type !== "skill") {
					return [];
				}
				return [
					{
						id: "skill-one",
						type: "skill",
						filePath: skillPath,
						item: {
							name: "skill-one",
							disabled: refreshed,
							description: "Skill one",
							instructions: "Use this skill.",
							frontmatter: {},
						},
					},
				];
			},
		} as unknown as UserInstructionConfigService;

		const result = await new CoreSettingsService().toggle({
			type: "skills",
			id: "skill-one",
			path: skillPath,
			name: "skill-one",
			enabled: false,
			workspaceRoot: tempRoot,
			cwd: tempRoot,
			userInstructionService,
		});
		const written = await readFile(skillPath, "utf8");

		expect(written).toContain("disabled: true");
		expect(result.changedTypes).toEqual(["skills"]);
		expect(result.snapshot.skills[0]?.enabled).toBe(false);
		expect(calls).toContain("refreshType:skill");
		expect(calls.lastIndexOf("listRecords:skill")).toBeGreaterThan(
			calls.indexOf("refreshType:skill"),
		);
	});

	it("uses cwd as the workspace root when listing instruction settings", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-settings-"));
		tempRoots.push(tempRoot);
		const skillDir = join(tempRoot, ".cline", "skills", "skill-one");
		await mkdir(skillDir, { recursive: true });
		await writeFile(join(skillDir, "SKILL.md"), "Use this skill.");

		const snapshot = await new CoreSettingsService().list({ cwd: tempRoot });

		expect(snapshot.skills).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "skill-one",
					name: "skill-one",
					source: "workspace",
					enabled: true,
				}),
			]),
		);
	});

	it("lists bundled plugin skills with plugin ownership metadata", async () => {
		const tempRoot = await mkdtemp(
			join(tmpdir(), "core-settings-plugin-skills-"),
		);
		tempRoots.push(tempRoot);
		const installRoot = join(
			tempRoot,
			".cline",
			"plugins",
			"_installed",
			"local",
			"test-plugin-skill-owner",
		);
		const packageRoot = join(installRoot, "package");
		const pluginPath = join(packageRoot, "index.ts");
		const skillDir = join(packageRoot, "skills", "test-plugin-skill-owner");
		await mkdir(skillDir, { recursive: true });
		await writeFile(
			join(installRoot, "package.json"),
			JSON.stringify({
				name: "test-plugin-skill-owner",
				cline: {
					plugins: [{ paths: ["./package/index.ts"] }],
				},
			}),
		);
		await writeFile(pluginPath, "export default {};");
		await writeFile(
			join(skillDir, "SKILL.md"),
			`---
name: test-plugin-skill-owner
description: Browser agent
---
Use the browser.`,
		);

		const snapshot = await new CoreSettingsService().list({ cwd: tempRoot });

		expect(snapshot.skills).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "test-plugin-skill-owner",
					name: "test-plugin-skill-owner",
					source: "workspace-plugin",
					pluginName: "test-plugin-skill-owner",
					pluginPath,
					enabled: true,
				}),
			]),
		);
		expect(
			snapshot.plugins.find((plugin) => plugin.path === pluginPath)
				?.contributions?.skills,
		).toEqual(["test-plugin-skill-owner"]);
	});

	it("does not list skills from disabled plugins", async () => {
		const tempRoot = await mkdtemp(
			join(tmpdir(), "core-settings-plugin-skills-"),
		);
		tempRoots.push(tempRoot);
		const settingsPath = join(tempRoot, "global-settings.json");
		process.env.CLINE_GLOBAL_SETTINGS_PATH = settingsPath;
		const installRoot = join(
			tempRoot,
			".cline",
			"plugins",
			"_installed",
			"local",
			"test-plugin-skill-disabled",
		);
		const packageRoot = join(installRoot, "package");
		const pluginPath = join(packageRoot, "index.ts");
		const skillDir = join(packageRoot, "skills", "test-plugin-skill-disabled");
		await mkdir(skillDir, { recursive: true });
		await writeFile(
			join(installRoot, "package.json"),
			JSON.stringify({
				name: "test-plugin-skill-disabled",
				cline: {
					plugins: [{ paths: ["./package/index.ts"] }],
				},
			}),
		);
		await writeFile(
			pluginPath,
			'throw new Error("disabled plugin executed"); export default {};',
		);
		await writeFile(
			join(skillDir, "SKILL.md"),
			`---
name: test-plugin-skill-disabled
description: Browser agent
---
Use the browser.`,
		);
		await writeFile(
			settingsPath,
			JSON.stringify({ disabledPlugins: [pluginPath] }),
		);

		const snapshot = await new CoreSettingsService().list({ cwd: tempRoot });
		const diagnostics = await listPluginToolsWithDiagnostics({
			workspacePath: tempRoot,
			cwd: tempRoot,
		});

		expect(snapshot.skills).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "test-plugin-skill-disabled",
					pluginPath,
				}),
			]),
		);
		expect(diagnostics.tools.some((tool) => tool.path === pluginPath)).toBe(
			false,
		);
		expect(
			diagnostics.plugins.some((plugin) => plugin.path === pluginPath),
		).toBe(false);
		expect(
			diagnostics.failures.some((failure) => failure.pluginPath === pluginPath),
		).toBe(false);
	});

	it("lists package plugins by canonical name and toggles them", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-settings-plugins-"));
		tempRoots.push(tempRoot);
		process.env.HOME = tempRoot;
		setHomeDir(tempRoot);
		const settingsPath = join(tempRoot, "global-settings.json");
		process.env.CLINE_GLOBAL_SETTINGS_PATH = settingsPath;
		const installRoot = join(
			tempRoot,
			".cline",
			"plugins",
			"_installed",
			"local",
			"canonical-plugin",
		);
		const packageRoot = join(installRoot, "package");
		const pluginPath = join(packageRoot, "src", "index.ts");
		await mkdir(join(packageRoot, "src"), { recursive: true });
		await writeFile(
			join(installRoot, "package.json"),
			JSON.stringify({
				name: "canonical-plugin",
				cline: {
					plugins: [
						{
							paths: ["./package/src/index.ts"],
							capabilities: ["tools", "rules", "hooks"],
						},
					],
				},
			}),
		);
		await writeFile(
			join(packageRoot, "package.json"),
			JSON.stringify({ name: "canonical-plugin", type: "module" }),
		);
		await mkdir(join(packageRoot, "skills"), { recursive: true });
		await writeFile(
			join(packageRoot, "skills", "code-review.md"),
			"# Code review\n",
		);
		await writeFile(
			pluginPath,
			[
				'export default { name: "canonical-plugin", manifest: { capabilities: ["tools", "rules", "hooks"] },',
				"setup(api) { api.registerTool({",
				'name: "canonical_tool", description: "Canonical tool",',
				'inputSchema: { type: "object", properties: {} },',
				"execute: async () => ({ ok: true }),",
				'}); api.registerRule({ id: "canonical_rule", content: "Rule" }); },',
				"hooks: { beforeRun() {} } };",
			].join("\n"),
		);
		const service = new CoreSettingsService();

		const listed = await service.list({ cwd: tempRoot });
		expect(listed.plugins).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: pluginPath,
					name: "canonical-plugin",
					path: pluginPath,
					kind: "plugin",
					source: "workspace-plugin",
					enabled: true,
					toggleable: true,
					contributions: expect.objectContaining({
						capabilities: ["hooks", "rules", "tools"],
						tools: ["canonical_tool"],
						skills: ["code-review"],
						rules: ["canonical_rule"],
						hooks: ["beforeRun"],
					}),
				}),
			]),
		);
		expect(listed.tools).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "canonical_tool",
					pluginName: "canonical-plugin",
					pluginPath,
					enabled: true,
				}),
			]),
		);

		const disabled = await service.toggle({
			type: "plugins",
			path: pluginPath,
			enabled: false,
			cwd: tempRoot,
		});
		expect(disabled.changedTypes).toEqual(["plugins"]);
		expect(
			disabled.snapshot.plugins.find((plugin) => plugin.path === pluginPath)
				?.enabled,
		).toBe(false);
		expect(
			disabled.snapshot.tools.find((tool) => tool.pluginPath === pluginPath),
		).toBeUndefined();
		expect(
			disabled.snapshot.plugins.find((plugin) => plugin.path === pluginPath)
				?.contributions,
		).toMatchObject({
			inspectionStatus: "disabled",
			skills: ["code-review"],
			tools: [],
		});
		expect(JSON.parse(await readFile(settingsPath, "utf8"))).toMatchObject({
			disabledPlugins: [pluginPath],
		});

		const enabled = await service.toggle({
			type: "plugins",
			path: pluginPath,
			cwd: tempRoot,
		});
		expect(
			enabled.snapshot.plugins.find((plugin) => plugin.path === pluginPath)
				?.enabled,
		).toBe(true);
	});

	it("does not use a shared plugin search-root package name for standalone plugins", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-settings-plugins-"));
		tempRoots.push(tempRoot);
		process.env.HOME = tempRoot;
		setHomeDir(tempRoot);
		const pluginRoot = join(tempRoot, ".cline", "plugins");
		await mkdir(pluginRoot, { recursive: true });
		await writeFile(
			join(pluginRoot, "package.json"),
			JSON.stringify({ name: "shared-plugin-root" }),
		);
		await writeFile(join(pluginRoot, "alpha.ts"), "export default {};");
		await writeFile(join(pluginRoot, "beta.ts"), "export default {};");

		const snapshot = await new CoreSettingsService().list({ cwd: tempRoot });

		expect(snapshot.plugins.map((plugin) => plugin.name).sort()).toEqual([
			"alpha",
			"beta",
		]);
	});

	it("lists and toggles MCP server disabled state", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-settings-"));
		tempRoots.push(tempRoot);
		const settingsPath = join(tempRoot, "cline_mcp_settings.json");
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		await writeFile(
			settingsPath,
			`${JSON.stringify(
				{
					otherSetting: true,
					mcpServers: {
						docs: {
							transport: {
								type: "stdio",
								command: "node",
							},
						},
					},
				},
				null,
				2,
			)}\n`,
		);
		const service = new CoreSettingsService();

		const snapshot = await service.list({ cwd: tempRoot });
		expect(snapshot.mcp).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "docs",
					name: "docs",
					path: settingsPath,
					kind: "mcp",
					enabled: true,
					toggleable: true,
				}),
			]),
		);

		const result = await service.toggle({
			type: "mcp",
			name: "docs",
			path: settingsPath,
			enabled: false,
			cwd: tempRoot,
		});
		const disabledSettings = JSON.parse(
			await readFile(settingsPath, "utf8"),
		) as {
			otherSetting?: boolean;
			mcpServers?: Record<string, { disabled?: boolean }>;
		};
		expect(result.changedTypes).toEqual(["mcp"]);
		expect(result.snapshot.mcp[0]?.enabled).toBe(false);
		expect(disabledSettings.otherSetting).toBe(true);
		expect(disabledSettings.mcpServers?.docs?.disabled).toBe(true);

		await service.toggle({
			type: "mcp",
			name: "docs",
			path: settingsPath,
			enabled: true,
			cwd: tempRoot,
		});
		const enabledSettings = JSON.parse(
			await readFile(settingsPath, "utf8"),
		) as {
			mcpServers?: Record<string, { disabled?: boolean }>;
		};
		expect(enabledSettings.mcpServers?.docs?.disabled).toBeUndefined();

		await service.toggle({
			type: "mcp",
			name: "docs",
			path: settingsPath,
			cwd: tempRoot,
		});
		const implicitlyDisabledSettings = JSON.parse(
			await readFile(settingsPath, "utf8"),
		) as {
			mcpServers?: Record<string, { disabled?: boolean }>;
		};
		expect(implicitlyDisabledSettings.mcpServers?.docs?.disabled).toBe(true);

		await service.toggle({
			type: "mcp",
			name: "docs",
			path: settingsPath,
			cwd: tempRoot,
		});
		const implicitlyEnabledSettings = JSON.parse(
			await readFile(settingsPath, "utf8"),
		) as {
			mcpServers?: Record<string, { disabled?: boolean }>;
		};
		expect(
			implicitlyEnabledSettings.mcpServers?.docs?.disabled,
		).toBeUndefined();
	});

	it("requires an explicit enabled value when skill state cannot be resolved", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-settings-"));
		tempRoots.push(tempRoot);
		const skillPath = join(tempRoot, "SKILL.md");
		await writeFile(skillPath, "Use this skill.");
		const userInstructionService = {
			async refreshType() {},
			listRecords(type: string) {
				if (type !== "skill") {
					return [];
				}
				return [
					{
						id: "skill-one",
						type: "skill",
						filePath: skillPath,
						item: {
							name: "skill-one",
							description: "Skill one",
							instructions: "Use this skill.",
							frontmatter: {},
						},
					},
				];
			},
		} as unknown as UserInstructionConfigService;

		await expect(
			new CoreSettingsService().toggle({
				type: "skills",
				id: "skill-one",
				path: skillPath,
				userInstructionService,
			}),
		).rejects.toThrow("Cannot determine toggle state");
	});

	it("rejects path-based skill toggles outside the resolved watcher snapshot", async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), "core-settings-"));
		const outsideRoot = await mkdtemp(join(tmpdir(), "core-settings-outside-"));
		tempRoots.push(workspaceRoot, outsideRoot);
		const outsidePath = join(outsideRoot, "SKILL.md");
		const outsideContent = "Outside file.";
		await writeFile(outsidePath, outsideContent);

		await expect(
			new CoreSettingsService().toggle({
				type: "skills",
				path: outsidePath,
				enabled: false,
				workspaceRoot,
				cwd: workspaceRoot,
			}),
		).rejects.toThrow("Unable to resolve skill setting");
		expect(await readFile(outsidePath, "utf8")).toBe(outsideContent);
	});

	it("honors explicit enabled values for plugin tool settings", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-settings-"));
		tempRoots.push(tempRoot);
		process.env.CLINE_GLOBAL_SETTINGS_PATH = join(
			tempRoot,
			"global-settings.json",
		);
		const service = new CoreSettingsService();

		await service.toggle({
			type: "tools",
			name: "plugin-tool",
			enabled: false,
		});
		await service.toggle({
			type: "tools",
			name: "plugin-tool",
			enabled: false,
		});

		expect(
			JSON.parse(
				await readFile(process.env.CLINE_GLOBAL_SETTINGS_PATH, "utf8"),
			),
		).toEqual({
			autoUpdateEnabled: true,
			disabledTools: ["plugin-tool"],
			telemetryOptOut: false,
		});

		await service.toggle({ type: "tools", name: "plugin-tool", enabled: true });

		expect(
			JSON.parse(
				await readFile(process.env.CLINE_GLOBAL_SETTINGS_PATH, "utf8"),
			),
		).toEqual({ autoUpdateEnabled: true, telemetryOptOut: false });
	});
});
