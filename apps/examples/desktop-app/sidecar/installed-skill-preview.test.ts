import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	getInstalledSkillPreview,
	readInstalledSkillFile,
} from "./installed-skill-preview";

let directory: string;
let skillPath: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "installed-skill-preview-"));
	await mkdir(join(directory, "skill"));
	skillPath = join(directory, "skill", "SKILL.md");
	await writeFile(
		skillPath,
		"---\nname: Installed skill\n---\n# Installed version\n",
	);
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

function inventory(path = skillPath) {
	return [
		{ name: "Installed skill", path, instructions: "", agentPlugin: true },
	];
}

describe("installed skill previews", () => {
	it("reads the installed copy and its supporting files even with empty inventory instructions", async () => {
		await writeFile(join(directory, "skill", "guide.markdown"), "# Guide");
		await mkdir(join(directory, "skill", "references"));
		await writeFile(
			join(directory, "skill", "references", "guide.md"),
			"# Local reference",
		);
		await writeFile(
			join(directory, "skill", "example.py"),
			"print('preview only')",
		);
		const result = await getInstalledSkillPreview({ skillPath }, inventory());
		expect(result.defaultPath).toBe("SKILL.md");
		expect(result.files.map((file) => file.path)).toEqual([
			"example.py",
			"guide.markdown",
			"references/guide.md",
			"SKILL.md",
		]);
		expect(result).not.toHaveProperty("sourceUrl");
		await expect(
			readInstalledSkillFile(
				{ skillPath, path: "references/guide.md" },
				inventory(),
			),
		).resolves.toEqual({
			path: "references/guide.md",
			content: "# Local reference",
			localPath: await realpath(
				join(directory, "skill", "references", "guide.md"),
			),
		});
		await expect(
			readInstalledSkillFile({ skillPath, path: "SKILL.md" }, inventory()),
		).resolves.toMatchObject({
			content: expect.stringContaining("# Installed version"),
		});
	});

	it("requires the skill in the current inventory for both index and reads", async () => {
		await expect(getInstalledSkillPreview({ skillPath }, [])).rejects.toThrow(
			"no longer installed",
		);
		await expect(
			readInstalledSkillFile({ skillPath, path: "SKILL.md" }, []),
		).rejects.toThrow("no longer installed");
		await expect(
			getInstalledSkillPreview(
				{ skillPath: join(directory, "unknown", "SKILL.md") },
				inventory(),
			),
		).rejects.toThrow("no longer installed");
	});

	it.skipIf(process.platform === "win32")(
		"supports symlinked installation directories without following links outside their real root",
		async () => {
			const linkedRoot = join(directory, "linked-install");
			await symlink(join(directory, "skill"), linkedRoot, "dir");
			const linkedSkillPath = join(linkedRoot, "SKILL.md");
			await writeFile(join(directory, "private.md"), "Outside content");
			await mkdir(join(directory, "outside"));
			await writeFile(
				join(directory, "outside", "secret.md"),
				"Outside directory",
			);
			await symlink(
				join(directory, "private.md"),
				join(linkedRoot, "outside.md"),
			);
			await symlink(
				join(directory, "outside"),
				join(linkedRoot, "references"),
				"dir",
			);
			const result = await getInstalledSkillPreview(
				{ skillPath: linkedSkillPath },
				inventory(linkedSkillPath),
			);
			expect(result.files.map((file) => file.path)).toEqual(["SKILL.md"]);
			await expect(
				readInstalledSkillFile(
					{ skillPath: linkedSkillPath, path: "SKILL.md" },
					inventory(linkedSkillPath),
				),
			).resolves.toMatchObject({
				content: expect.stringContaining("# Installed version"),
				localPath: await realpath(skillPath),
			});
			for (const path of ["outside.md", "references/secret.md"]) {
				await expect(
					readInstalledSkillFile(
						{ skillPath: linkedSkillPath, path },
						inventory(linkedSkillPath),
					),
				).rejects.toThrow("outside the installed skill directory");
			}
		},
	);

	it.skipIf(process.platform === "win32")(
		"rejects an installed SKILL.md that links outside the installation directory",
		async () => {
			await writeFile(join(directory, "outside.md"), "Not skill content");
			await rm(skillPath);
			await symlink(join(directory, "outside.md"), skillPath);
			await expect(
				getInstalledSkillPreview({ skillPath }, inventory()),
			).rejects.toThrow("outside its skill directory");
			await expect(
				readInstalledSkillFile({ skillPath, path: "SKILL.md" }, inventory()),
			).rejects.toThrow("outside its skill directory");
		},
	);

	it.skipIf(process.platform === "win32")(
		"rejects a directory link outside the root even when a nested link points back inside",
		async () => {
			await mkdir(join(directory, "outside"));
			await symlink(skillPath, join(directory, "outside", "back.md"));
			await symlink(
				join(directory, "outside"),
				join(directory, "skill", "outside"),
				"dir",
			);
			await expect(
				readInstalledSkillFile(
					{ skillPath, path: "outside/back.md" },
					inventory(),
				),
			).rejects.toThrow("outside the installed skill directory");
		},
	);

	it.skipIf(process.platform === "win32")(
		"allows references within the root and bounds directory symlink cycles",
		async () => {
			await mkdir(join(directory, "skill", "references"));
			await writeFile(
				join(directory, "skill", "references", "guide.md"),
				"# Reference",
			);
			await symlink(
				join(directory, "skill", "references", "guide.md"),
				join(directory, "skill", "guide.md"),
			);
			await symlink(
				join(directory, "skill"),
				join(directory, "skill", "references", "loop"),
				"dir",
			);
			const result = await getInstalledSkillPreview({ skillPath }, inventory());
			expect(result.files.map((file) => file.path)).toEqual([
				"guide.md",
				"references/guide.md",
				"SKILL.md",
			]);
			await expect(
				readInstalledSkillFile({ skillPath, path: "guide.md" }, inventory()),
			).resolves.toEqual({
				path: "guide.md",
				content: "# Reference",
				localPath: await realpath(
					join(directory, "skill", "references", "guide.md"),
				),
			});
		},
	);

	it.each([
		"../private.md",
		"/private.md",
		"references/../../private.md",
		"references\\private.md",
		"C:/private.md",
		"./SKILL.md",
		"references//guide.md",
		"bad\u0000.md",
		"",
	])("rejects invalid relative file path %j", async (path) => {
		await expect(
			readInstalledSkillFile({ skillPath, path }, inventory()),
		).rejects.toThrow("supported skill file path");
	});

	it("omits oversized, binary, invalid UTF-8, and unsupported files and rejects direct reads", async () => {
		const unsupported = new Map<string, string | Buffer>([
			["large.md", "a".repeat(512 * 1024 + 1)],
			["binary.md", Buffer.from([65, 0, 66])],
			["invalid.md", Buffer.from([0xff, 0xfe])],
			["image.png", "image bytes"],
		]);
		for (const [name, content] of unsupported)
			await writeFile(join(directory, "skill", name), content);
		const result = await getInstalledSkillPreview({ skillPath }, inventory());
		expect(result.files.map((file) => file.path)).toEqual(["SKILL.md"]);
		for (const path of unsupported.keys())
			await expect(
				readInstalledSkillFile({ skillPath, path }, inventory()),
			).rejects.toThrow();
	});

	it("lists as many files as the preview allows and says the list is partial", async () => {
		await Promise.all(
			Array.from({ length: 512 }, (_, index) =>
				writeFile(join(directory, "skill", `${index}.md`), "# Text"),
			),
		);
		const result = await getInstalledSkillPreview({ skillPath }, inventory());
		expect(result.truncated).toBe(true);
		expect(result.files).toHaveLength(512);
		// The skill's own file is never the one left out.
		expect(result.files.map((file) => file.path)).toContain("SKILL.md");
	});

	it("bounds total preview content without failing to open the skill", async () => {
		await Promise.all(
			Array.from({ length: 17 }, (_, index) =>
				writeFile(
					join(directory, "skill", `${index}.md`),
					"a".repeat(512 * 1024),
				),
			),
		);
		const result = await getInstalledSkillPreview({ skillPath }, inventory());
		expect(result.truncated).toBe(true);
		expect(result.files.map((file) => file.path)).toContain("SKILL.md");
		expect(
			result.files.reduce((total, file) => total + file.size, 0),
		).toBeLessThanOrEqual(8 * 1024 * 1024);
	});

	it("skips tooling folders and still opens a skill with thousands of entries", async () => {
		for (const folder of ["node_modules/pkg", ".git/objects", "many"])
			await mkdir(join(directory, "skill", folder), { recursive: true });
		await writeFile(
			join(directory, "skill", "node_modules/pkg/README.md"),
			"# Dependency",
		);
		await writeFile(join(directory, "skill", ".git/objects/note.md"), "# Git");
		await Promise.all(
			Array.from({ length: 2_100 }, (_, index) =>
				writeFile(join(directory, "skill", "many", `${index}.bin`), ""),
			),
		);
		const result = await getInstalledSkillPreview({ skillPath }, inventory());
		expect(result.truncated).toBe(true);
		const paths = result.files.map((file) => file.path);
		expect(paths).toContain("SKILL.md");
		expect(paths.some((path) => /node_modules|\.git\//.test(path))).toBe(false);
	});

	it.each([
		{ type: "binary", byte: 0 },
		{ type: "invalid UTF-8", byte: 0xff },
	])("counts rejected $type files against the read budget", async ({
		byte,
	}) => {
		const content = Buffer.alloc(512 * 1024, byte);
		await Promise.all(
			Array.from({ length: 17 }, (_, index) =>
				writeFile(join(directory, "skill", `${index}.md`), content),
			),
		);
		// Unreadable files still spend the budget, so the scan stops early.
		const result = await getInstalledSkillPreview({ skillPath }, inventory());
		expect(result.truncated).toBe(true);
		expect(result.files.map((file) => file.path)).toEqual(["SKILL.md"]);
	});

	it("does not keep stale content between reads", async () => {
		await getInstalledSkillPreview({ skillPath }, inventory());
		await writeFile(skillPath, "# Updated locally");
		await expect(
			readInstalledSkillFile({ skillPath, path: "SKILL.md" }, inventory()),
		).resolves.toEqual({
			path: "SKILL.md",
			content: "# Updated locally",
			localPath: await realpath(skillPath),
		});
	});
});
