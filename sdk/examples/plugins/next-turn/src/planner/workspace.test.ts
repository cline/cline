import { afterEach, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGitStatusV2, readGitFacts } from "./git";
import { buildPlannerInput } from "./prompt";
import {
	documentedCommands,
	makeTargets,
	RepoReader,
	readRepoFacts,
	verifyScripts,
} from "./repo";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
	const dir = mkdtempSync(join(tmpdir(), "workspace-"));
	dirs.push(dir);
	return dir;
};

test("git status v2 gives the branch, commit, divergence and each changed path", () => {
	const status = parseGitStatusV2(
		[
			"# branch.oid abcdef0123456789",
			"# branch.head main",
			"# branch.ab +1 -3",
			"1 M. N... 100644 100644 100644 a b src/staged.ts",
			"2 R. N... 100644 100644 100644 a b R100 src/new name.ts\tsrc/old.ts",
			"u UU N... 100644 100644 100644 100644 a b c src/conflict.ts",
			"? notes.md",
		].join("\n"),
	);
	expect(status).toEqual({
		branch: "main",
		commit: "abcdef012",
		ahead: 1,
		behind: 3,
		dirty: [
			"M src/staged.ts",
			"R src/new name.ts",
			"UU src/conflict.ts",
			"?? notes.md",
		],
	});
});

test("a long tree lists eight paths and counts the rest", async () => {
	const lines = Array.from(
		{ length: 11 },
		(_, index) => `1 .M N... 100644 100644 100644 a b src/f${index}.ts`,
	);
	const facts = await readGitFacts(async () => lines.join("\n"), "/w");
	expect(facts).toMatchObject({
		heading: expect.stringContaining("git state"),
	});
	const text = typeof facts === "object" ? facts.lines.join("\n") : "";
	expect(text).toContain("Working tree: 11 changed files");
	expect(text).toContain("Changed: M src/f7.ts");
	expect(text).not.toContain("src/f8.ts");
	expect(text).toContain("and 3 more changed files");
});

test("a clean tree says so; not a repository has no section; any other failure is unknown", async () => {
	const clean = await readGitFacts(
		async () => "# branch.head main\n# branch.oid abc",
		"/w",
	);
	expect(typeof clean === "object" && clean.lines).toContain(
		"Working tree: clean",
	);
	expect(
		await readGitFacts(async () => {
			throw Object.assign(new Error("fatal"), {
				code: 128,
				stderr:
					"fatal: not a git repository (or any of the parent directories): .git",
			});
		}, "/w"),
	).toBeUndefined();
	expect(
		await readGitFacts(async () => {
			throw Object.assign(new Error("fatal"), {
				code: 128,
				stderr: "fatal: bad config line 3 in file .git/config",
			});
		}, "/w"),
	).toBe("unknown");
	expect(
		await readGitFacts(async () => {
			throw new Error("timed out");
		}, "/w"),
	).toBe("unknown");
});

test("the repository's commands come from scripts, make targets and documented sections", () => {
	const dir = tempDir();
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({
			scripts: { check: "x", "test:unit": "x", dev: "x", build: "x" },
		}),
	);
	writeFileSync(join(dir, "pnpm-lock.yaml"), "");
	writeFileSync(
		join(dir, "Makefile"),
		"test:\n\techo\nclean:\n\techo\nlint-fix:\n\techo\n",
	);
	writeFileSync(
		join(dir, "AGENTS.md"),
		"# Project\n\n## Commands\n\n```sh\nbun run check # everything\nbun test\n```\n\n## Other\n\n```sh\nrm -rf /\n```\n",
	);
	mkdirSync(join(dir, ".clinerules"));
	writeFileSync(
		join(dir, ".clinerules", "push.md"),
		"## Before you push\n```\nbun run lint\n```\n",
	);
	const facts = readRepoFacts(dir, new RepoReader());
	if (!facts || facts === "unknown")
		throw new Error("expected repository commands");
	expect(facts.lines).toEqual([
		"Script: `pnpm run build`",
		"Script: `pnpm run check`",
		"Script: `pnpm run test:unit`",
		"Make target: `make lint-fix`",
		"Make target: `make test`",
		"Documented: `bun run check`",
		"Documented: `bun test`",
		"Documented: `bun run lint`",
	]);
});

test("a command file that cannot be read is unknown, not an empty command list", () => {
	const dir = tempDir();
	const path = join(dir, "package.json");
	writeFileSync(path, JSON.stringify({ scripts: { test: "bun test" } }));
	chmodSync(path, 0);
	try {
		expect(readRepoFacts(dir, new RepoReader())).toBe("unknown");
	} finally {
		chmodSync(path, 0o644);
	}
});

test("a folder with no command files has no section", () => {
	expect(readRepoFacts(tempDir(), new RepoReader())).toBeUndefined();
	expect(verifyScripts("not json")).toEqual([]);
	expect(documentedCommands("no headings")).toEqual([]);
	expect(makeTargets("")).toEqual([]);
});

test("the prompt shows only sections that exist and names unreadable ones", () => {
	const input = buildPlannerInput({
		facts: { status: "failed", filesEdited: 0, toolErrored: true },
		context: {
			request: "do it",
			reply: "",
			tools: [{ name: "run_commands", failed: true, error: "exit 1" }],
			editedPaths: [],
		},
		mode: "plan",
		sources: [
			{
				heading: "This repository's commands",
				lines: ["Script: `bun run check`"],
			},
		],
		unread: ["This folder's git state"],
	});
	expect(input.user).toBe(
		[
			"## The turn that just ended",
			"Outcome — status: failed; files edited: 0; a command failed: yes",
			'What the person asked:\n"""\ndo it\n"""',
			"Tools the agent ran:\n- run_commands: FAILED — exit 1",
			"",
			"## This repository's commands",
			"- Script: `bun run check`",
			"",
			"## Could not read just now",
			"- This folder's git state — treat as unknown, not empty.",
		].join("\n"),
	);
	expect(input.system).toContain("The chat is in plan mode");
	expect(
		buildPlannerInput({
			facts: { status: "completed", filesEdited: 0, toolErrored: false },
			context: { request: "", reply: "", tools: [], editedPaths: [] },
			sources: [],
			unread: [],
		}).system,
	).not.toContain("plan mode");
});
