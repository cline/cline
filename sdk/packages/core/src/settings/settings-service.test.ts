import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UserInstructionConfigService } from "../extensions/config";
import { CoreSettingsService } from "./settings-service";

describe("CoreSettingsService", () => {
	const tempRoots: string[] = [];
	const envSnapshot = {
		CLINE_GLOBAL_SETTINGS_PATH: process.env.CLINE_GLOBAL_SETTINGS_PATH,
		CLINE_MCP_SETTINGS_PATH: process.env.CLINE_MCP_SETTINGS_PATH,
	};

	afterEach(async () => {
		process.env.CLINE_GLOBAL_SETTINGS_PATH =
			envSnapshot.CLINE_GLOBAL_SETTINGS_PATH;
		process.env.CLINE_MCP_SETTINGS_PATH = envSnapshot.CLINE_MCP_SETTINGS_PATH;
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
			disabledTools: ["plugin-tool"],
			telemetryOptOut: false,
		});

		await service.toggle({ type: "tools", name: "plugin-tool", enabled: true });

		expect(
			JSON.parse(
				await readFile(process.env.CLINE_GLOBAL_SETTINGS_PATH, "utf8"),
			),
		).toEqual({ telemetryOptOut: false });
	});
});
