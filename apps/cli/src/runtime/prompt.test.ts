import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildUserInputMessage, resolveSystemPrompt } from "./prompt";

const workspaceDirectories: string[] = [];

afterEach(() => {
	for (const directory of workspaceDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("buildUserInputMessage", () => {
	it("extracts image mentions into userImages", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cli-prompt-"));
		const imagePath = join(dir, "hero.png");
		writeFileSync(imagePath, Buffer.from("hello"));

		const result = await buildUserInputMessage(
			`@${imagePath} describe this image`,
		);

		expect(result.prompt).toBe("[image: hero.png] describe this image");
		expect(result.userImages).toEqual(["data:image/png;base64,aGVsbG8="]);
		expect(result.userFiles).toEqual([]);
	});

	it("extracts text file mentions into userFiles", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cli-prompt-"));
		const filePath = join(dir, "notes.md");
		writeFileSync(filePath, "# Notes\n");

		const result = await buildUserInputMessage(`summarize @${filePath}`);

		expect(result.prompt).toBe("summarize [file: notes.md]");
		expect(result.userImages).toEqual([]);
		expect(result.userFiles).toEqual([filePath]);
	});

	it("extracts quoted text file mentions with spaces into userFiles", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cli prompt "));
		const filePath = join(dir, "notes with spaces.md");
		writeFileSync(filePath, "# Notes\n");

		const result = await buildUserInputMessage(`summarize @"${filePath}"`);

		expect(result.prompt).toBe("summarize [file: notes with spaces.md]");
		expect(result.userImages).toEqual([]);
		expect(result.userFiles).toEqual([filePath]);
	});
});

describe("resolveSystemPrompt workspace metadata", () => {
	it("includes git remotes and the latest commit for Cline requests", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cline-prompt-"));
		workspaceDirectories.push(cwd);
		execFileSync("git", ["init"], { cwd });
		execFileSync("git", ["config", "user.email", "test@cline.bot"], { cwd });
		execFileSync("git", ["config", "user.name", "Cline Test"], { cwd });
		writeFileSync(join(cwd, "README.md"), "test\n");
		execFileSync("git", ["add", "README.md"], { cwd });
		execFileSync("git", ["commit", "-m", "initial"], { cwd });
		execFileSync("git", ["remote", "add", "origin", "https://example.com/cline/repo.git"], { cwd });
		const commit = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd,
			encoding: "utf8",
		}).trim();

		const prompt = await resolveSystemPrompt({ cwd, providerId: "cline" });

		expect(prompt).toContain("origin: https://example.com/cline/repo.git");
		expect(prompt).toContain(commit);
	});

	it("includes parseable metadata outside a project", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cline-prompt-"));
		workspaceDirectories.push(cwd);

		const prompt = await resolveSystemPrompt({ cwd, providerId: "cline" });

		expect(prompt).toContain("# Workspace Configuration");
		expect(prompt).toContain(JSON.stringify(cwd));
		expect(prompt).toContain(`"hint": "${basename(cwd)}"`);
		expect(prompt).not.toContain("associatedRemoteUrls");
		expect(prompt).not.toContain("latestGitCommitHash");
	});
});
