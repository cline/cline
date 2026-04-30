import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UserInstructionConfigWatcher } from "../extensions/config";
import { CoreSettingsService } from "./settings-service";

describe("CoreSettingsService", () => {
	const tempRoots: string[] = [];
	const envSnapshot = {
		CLINE_GLOBAL_SETTINGS_PATH: process.env.CLINE_GLOBAL_SETTINGS_PATH,
	};

	afterEach(async () => {
		process.env.CLINE_GLOBAL_SETTINGS_PATH =
			envSnapshot.CLINE_GLOBAL_SETTINGS_PATH;
		await Promise.all(
			tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempRoots.length = 0;
	});

	it("toggles skill frontmatter and refreshes the skill watcher before returning a snapshot", async () => {
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
		const watcher = {
			async refreshType(type: string) {
				calls.push(`refreshType:${type}`);
				refreshed = true;
			},
			getSnapshot(type: string) {
				calls.push(`getSnapshot:${type}`);
				if (type !== "skill") {
					return new Map();
				}
				return new Map([
					[
						"skill-one",
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
					],
				]);
			},
		} as unknown as UserInstructionConfigWatcher;

		const result = await new CoreSettingsService().toggle({
			type: "skills",
			id: "skill-one",
			path: skillPath,
			name: "skill-one",
			enabled: false,
			workspaceRoot: tempRoot,
			cwd: tempRoot,
			userInstructionWatcher: watcher,
		});
		const written = await readFile(skillPath, "utf8");

		expect(written).toContain("disabled: true");
		expect(result.changedTypes).toEqual(["skills"]);
		expect(result.snapshot.skills[0]?.enabled).toBe(false);
		expect(calls).toContain("refreshType:skill");
		expect(calls.lastIndexOf("getSnapshot:skill")).toBeGreaterThan(
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

	it("requires an explicit enabled value when skill state cannot be resolved", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-settings-"));
		tempRoots.push(tempRoot);
		const skillPath = join(tempRoot, "SKILL.md");
		await writeFile(skillPath, "Use this skill.");

		await expect(
			new CoreSettingsService().toggle({
				type: "skills",
				path: skillPath,
			}),
		).rejects.toThrow("Cannot determine toggle state");
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
		).toEqual({ disabledTools: ["plugin-tool"] });

		await service.toggle({ type: "tools", name: "plugin-tool", enabled: true });

		expect(
			JSON.parse(
				await readFile(process.env.CLINE_GLOBAL_SETTINGS_PATH, "utf8"),
			),
		).toEqual({});
	});
});
