import * as fsModule from "node:fs";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installGitHubSkill, parseGitHubSkillSource } from "./skill-install";

// Lets a test make one rename fail; every other call is the real one.
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

type ArchiveEntry =
	| { path: string; content: string; mode?: number }
	| { path: string; link: string };

// Builds a GitHub-style tarball: every entry under one "<repo>-<sha>/" root,
// with a pax header for paths too long for the ustar name field.
function githubTarball(entries: ArchiveEntry[]): Buffer {
	const blocks: Buffer[] = [];
	const header = (
		name: string,
		size: number,
		typeflag: string,
		options: { mode?: number; link?: string } = {},
	) => {
		const block = Buffer.alloc(512);
		block.write(name.slice(0, 100), 0);
		block.write(
			`${(options.mode ?? 0o644).toString(8).padStart(7, "0")}\0`,
			100,
		);
		block.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
		block.write(typeflag, 156);
		if (options.link) block.write(options.link, 157);
		block.write("ustar\0", 257);
		block.write("00", 263);
		block.fill(" ", 148, 156);
		let checksum = 0;
		for (const byte of block) checksum += byte;
		block.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
		return block;
	};
	const pad = (data: Buffer) =>
		Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
	const push = (
		name: string,
		typeflag: string,
		data: Buffer,
		options: { mode?: number; link?: string } = {},
	) => {
		if (Buffer.byteLength(name) > 100) {
			const record = ` path=${name}\n`;
			let length = record.length;
			length += String(length + String(length).length).length;
			const pax = Buffer.from(`${length}${record}`);
			blocks.push(header("PaxHeader", pax.length, "x"), pad(pax));
		}
		blocks.push(header(name, data.length, typeflag, options), pad(data));
	};
	push("skills-abc123/", "5", Buffer.alloc(0), { mode: 0o755 });
	for (const entry of entries) {
		const name = `skills-abc123/${entry.path}`;
		if ("link" in entry) {
			push(name, "2", Buffer.alloc(0), { link: entry.link });
		} else {
			push(name, "0", Buffer.from(entry.content), { mode: entry.mode });
		}
	}
	blocks.push(Buffer.alloc(1024));
	return gzipSync(Buffer.concat(blocks));
}

function skillMd(name: string, body = "Body"): string {
	return `---\nname: ${name}\ndescription: ${name} description\n---\n\n${body}\n`;
}

function fetchReturning(archive: Buffer, calls: string[] = []): typeof fetch {
	return (async (input: string | URL | Request) => {
		calls.push(String(input));
		return new Response(new Uint8Array(archive), { status: 200 });
	}) as typeof fetch;
}

function listFiles(dir: string, prefix = ""): string[] {
	return readdirSync(dir, { withFileTypes: true })
		.flatMap((entry) =>
			entry.isDirectory()
				? listFiles(join(dir, entry.name), `${prefix}${entry.name}/`)
				: [`${prefix}${entry.name}`],
		)
		.sort();
}

describe("parseGitHubSkillSource", () => {
	it("parses the marketplace source forms", () => {
		expect(
			parseGitHubSkillSource(["cline/skills", "--skill", "review-team"]),
		).toEqual({ owner: "cline", repo: "skills", skill: "review-team" });
		expect(parseGitHubSkillSource(["cline/sdk-skill"])).toEqual({
			owner: "cline",
			repo: "sdk-skill",
		});
		expect(
			parseGitHubSkillSource(["github.com/cline/skills@review-team"]),
		).toEqual({ owner: "cline", repo: "skills", skill: "review-team" });
		expect(
			parseGitHubSkillSource([
				"https://github.com/vercel-labs/agent-skills.git",
				"--skill=web-design-guidelines",
			]),
		).toEqual({
			owner: "vercel-labs",
			repo: "agent-skills",
			skill: "web-design-guidelines",
		});
		expect(
			parseGitHubSkillSource([
				"https://github.com/cline/skills/tree/main/skills/review-team",
			]),
		).toEqual({
			owner: "cline",
			repo: "skills",
			ref: "main",
			subpath: "skills/review-team",
		});
	});

	it("leaves sources it cannot handle to the skills CLI", () => {
		expect(parseGitHubSkillSource(["https://gitlab.com/a/b"])).toBeUndefined();
		expect(parseGitHubSkillSource(["gitlab.com/a/b"])).toBeUndefined();
		expect(parseGitHubSkillSource(["git@github.com:a/b.git"])).toBeUndefined();
		expect(parseGitHubSkillSource(["./local-skill"])).toBeUndefined();
		expect(parseGitHubSkillSource(["C:\\skills\\mine"])).toBeUndefined();
		expect(parseGitHubSkillSource(["cline/skills", "--list"])).toBeUndefined();
		expect(
			parseGitHubSkillSource(["cline/skills", "other/repo"]),
		).toBeUndefined();
		expect(
			parseGitHubSkillSource(["https://github.com/a/b/tree/main/../../x"]),
		).toBeUndefined();
		expect(parseGitHubSkillSource([])).toBeUndefined();
	});
});

describe("installGitHubSkill", () => {
	let root = "";
	let skillsDir = "";

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "core-skill-install-"));
		skillsDir = join(root, "skills");
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("installs the requested skill by its frontmatter name", async () => {
		const calls: string[] = [];
		const archive = githubTarball([
			{ path: "README.md", content: "repo readme" },
			{ path: "skills/other/SKILL.md", content: skillMd("other") },
			{ path: "skills/review/SKILL.md", content: skillMd("Review Team") },
			{ path: "skills/review/agents/grader.md", content: "grader\n" },
			{ path: "skills/review/metadata.json", content: "{}" },
			{ path: "skills/review/.git/HEAD", content: "ref" },
			{
				path: "skills/review/scripts/run.sh",
				content: "#!/bin/sh",
				mode: 0o755,
			},
		]);

		const result = await installGitHubSkill(
			{ owner: "cline", repo: "skills", skill: "review-team" },
			{ skillsDir, fetch: fetchReturning(archive, calls) },
		);

		expect(calls).toEqual([
			"https://codeload.github.com/cline/skills/tar.gz/HEAD",
		]);
		expect(result).toMatchObject({
			name: "review-team",
			installPath: join(skillsDir, "review-team"),
			fileCount: 3,
			skippedPaths: [],
		});
		expect(listFiles(result.installPath)).toEqual([
			"SKILL.md",
			"agents/grader.md",
			"scripts/run.sh",
		]);
		expect(
			readFileSync(join(result.installPath, "agents/grader.md"), "utf8"),
		).toBe("grader\n");
		// Only the installed skill ends up in the skills directory.
		expect(readdirSync(skillsDir)).toEqual(["review-team"]);
	});

	it("matches a skill by directory name when its frontmatter name differs", async () => {
		const archive = githubTarball([
			{ path: "skills/mintlify-skill/SKILL.md", content: skillMd("mintlify") },
		]);

		const result = await installGitHubSkill(
			{ owner: "a", repo: "b", skill: "mintlify-skill" },
			{ skillsDir, fetch: fetchReturning(archive) },
		);

		expect(result.name).toBe("mintlify");
	});

	it("installs the only skill in a repository when none is requested", async () => {
		const archive = githubTarball([
			{ path: "skill/cline-sdk/SKILL.md", content: skillMd("cline-sdk") },
			{ path: "skill/cline-sdk/references/api.md", content: "api" },
		]);

		const result = await installGitHubSkill(
			{ owner: "cline", repo: "sdk-skill" },
			{ skillsDir, fetch: fetchReturning(archive) },
		);

		expect(result.name).toBe("cline-sdk");
		expect(listFiles(result.installPath)).toEqual([
			"SKILL.md",
			"references/api.md",
		]);
	});

	it("refuses to guess between several skills", async () => {
		const archive = githubTarball([
			{ path: "skills/a/SKILL.md", content: skillMd("alpha") },
			{ path: "skills/b/SKILL.md", content: skillMd("beta") },
		]);

		await expect(
			installGitHubSkill(
				{ owner: "o", repo: "r" },
				{ skillsDir, fetch: fetchReturning(archive) },
			),
		).rejects.toThrow(
			"o/r contains 2 skills; choose one with --skill. Available: alpha, beta",
		);
		await expect(
			installGitHubSkill(
				{ owner: "o", repo: "r", skill: "gamma" },
				{ skillsDir, fetch: fetchReturning(archive) },
			),
		).rejects.toThrow(
			'Skill "gamma" was not found in o/r. Available: alpha, beta',
		);
		expect(existsSync(skillsDir)).toBe(false);
	});

	it("copies symlinked content and skips links that leave the archive", async () => {
		const archive = githubTarball([
			{ path: "shared/style.css", content: "body{}" },
			{ path: "shared/refs/a.md", content: "a" },
			{ path: "skills/data/SKILL.md", content: skillMd("data") },
			{ path: "skills/data/style.css", link: "../../shared/style.css" },
			{ path: "skills/data/refs", link: "../../shared/refs" },
			{
				path: "skills/data/skills/chdb-sql",
				link: "../../../.vendor/clickhouse/skills/chdb-sql",
			},
		]);

		const result = await installGitHubSkill(
			{ owner: "o", repo: "r", skill: "data" },
			{ skillsDir, fetch: fetchReturning(archive) },
		);

		expect(listFiles(result.installPath)).toEqual([
			"SKILL.md",
			"refs/a.md",
			"style.css",
		]);
		expect(result.skippedPaths).toEqual(["skills/data/skills/chdb-sql"]);
	});

	it("reads pax long paths and ignores entries that escape the repository", async () => {
		const deep = `skills/long/${"nested-directory/".repeat(8)}file.md`;
		const archive = githubTarball([
			{ path: "skills/long/SKILL.md", content: skillMd("long") },
			{ path: deep, content: "deep" },
			{ path: "../../escape.md", content: "nope" },
		]);

		const result = await installGitHubSkill(
			{ owner: "o", repo: "r" },
			{ skillsDir, fetch: fetchReturning(archive) },
		);

		expect(listFiles(result.installPath)).toEqual([
			"SKILL.md",
			deep.slice("skills/long/".length),
		]);
		expect(existsSync(join(root, "escape.md"))).toBe(false);
	});

	it("replaces a leftover directory and leaves no staging directory behind", async () => {
		const leftover = join(skillsDir, "review");
		mkdirSync(leftover, { recursive: true });
		writeFileSync(join(leftover, "stale.txt"), "stale");
		const archive = githubTarball([
			{ path: "SKILL.md", content: skillMd("review") },
		]);

		await installGitHubSkill(
			{ owner: "o", repo: "review" },
			{ skillsDir, fetch: fetchReturning(archive) },
		);

		expect(readdirSync(skillsDir)).toEqual(["review"]);
		expect(readdirSync(root)).toEqual(["skills"]);
		expect(listFiles(leftover)).toEqual(["SKILL.md"]);
	});

	it("reports missing repositories and network failures", async () => {
		await expect(
			installGitHubSkill(
				{ owner: "o", repo: "gone" },
				{
					skillsDir,
					fetch: (async () =>
						new Response("", { status: 404 })) as typeof fetch,
				},
			),
		).rejects.toThrow("GitHub repository o/gone was not found or is private.");
		await expect(
			installGitHubSkill(
				{ owner: "o", repo: "r" },
				{
					skillsDir,
					fetch: (async () => {
						throw new Error("getaddrinfo ENOTFOUND codeload.github.com");
					}) as typeof fetch,
				},
			),
		).rejects.toThrow(
			"Could not download o/r from GitHub: getaddrinfo ENOTFOUND codeload.github.com",
		);
	});
	it("accepts skills whose SKILL.md has no name, like Cline's loader", async () => {
		const nested = githubTarball([
			{ path: "skills/plain/SKILL.md", content: "# Plain skill\n" },
		]);
		const nestedResult = await installGitHubSkill(
			{ owner: "o", repo: "r", skill: "plain" },
			{ skillsDir, fetch: fetchReturning(nested) },
		);
		expect(nestedResult.name).toBe("plain");

		const root = githubTarball([
			{ path: "SKILL.md", content: "---\ndescription: no name\n---\n" },
		]);
		const rootResult = await installGitHubSkill(
			{ owner: "o", repo: "root-skill" },
			{ skillsDir, fetch: fetchReturning(root) },
		);
		expect(rootResult.name).toBe("root-skill");
		expect(listFiles(rootResult.installPath)).toEqual(["SKILL.md"]);
	});

	it("installs under a caller-accepted name when the frontmatter name differs", async () => {
		const archive = githubTarball([
			{ path: "skills/foo/SKILL.md", content: skillMd("bar") },
		]);

		const result = await installGitHubSkill(
			{ owner: "o", repo: "r", skill: "foo" },
			{
				skillsDir,
				fetch: fetchReturning(archive),
				acceptedNames: ["foo", "Foo Skill"],
			},
		);

		expect(result.installPath).toBe(join(skillsDir, "foo"));
		expect(readdirSync(skillsDir)).toEqual(["foo"]);
	});

	it("keeps the existing skill when the final swap fails", async () => {
		const existing = join(skillsDir, "review");
		mkdirSync(existing, { recursive: true });
		writeFileSync(join(existing, "SKILL.md"), "old");
		const archive = githubTarball([
			{ path: "SKILL.md", content: skillMd("review") },
		]);
		const rename = vi.mocked(fsModule.renameSync);
		const realRename = rename.getMockImplementation();
		rename.mockImplementation((from, to) => {
			if (String(from).includes(".cline-skill-staging-")) {
				throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
			}
			return realRename?.(from, to);
		});
		try {
			await expect(
				installGitHubSkill(
					{ owner: "o", repo: "review" },
					{ skillsDir, fetch: fetchReturning(archive) },
				),
			).rejects.toThrow("disk full");
		} finally {
			rename.mockImplementation(realRename ?? (() => undefined));
		}

		expect(readFileSync(join(existing, "SKILL.md"), "utf8")).toBe("old");
		expect(readdirSync(root)).toEqual(["skills"]);
	});

	it("stops reading an archive once it exceeds the size limit", async () => {
		let pulls = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulls++;
				controller.enqueue(new Uint8Array(1024));
			},
		});

		await expect(
			installGitHubSkill(
				{ owner: "o", repo: "huge" },
				{
					skillsDir,
					maxArchiveBytes: 4096,
					fetch: (async () =>
						new Response(body, { status: 200 })) as typeof fetch,
				},
			),
		).rejects.toThrow("o/huge is too large to install as a skill.");
		expect(pulls).toBeLessThan(10);
	});
});
