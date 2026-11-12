import { execFile } from "node:child_process";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { FactoryCheck, FactoryWorkspace } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FactoryPublishError } from "./factory-errors";
import {
	assertFactoryCandidate,
	checkpointFactoryWorkspace,
	factoryBranchName,
	factoryCheckConfigurationFindings,
	integrateFactoryCommit,
	prepareFactoryWorkspace,
	publishFactoryPullRequest,
	resolveFactoryPullRequestBase,
	runFactoryCommand,
	updateFactoryPullRequestBody,
	verifyFactoryChecks,
} from "./factory-local";

const exec = promisify(execFile);
const png =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNCkAAAAASUVORK5CYII=";
let root: string;
let sourceRoot: string;
let storageDir: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), "factory-local-test-"));
	sourceRoot = path.join(root, "source");
	storageDir = path.join(root, "storage");
	await mkdir(sourceRoot);
	await exec("git", ["init", "-b", "main"], { cwd: sourceRoot });
	await exec("git", ["config", "user.email", "factory@example.test"], {
		cwd: sourceRoot,
	});
	await exec("git", ["config", "user.name", "Factory Test"], {
		cwd: sourceRoot,
	});
	await writeFile(path.join(sourceRoot, ".gitignore"), "evidence/\n");
	await writeFile(path.join(sourceRoot, "feature.txt"), "before\n");
	await exec("git", ["add", "."], { cwd: sourceRoot });
	await exec("git", ["commit", "-m", "Initial fixture"], { cwd: sourceRoot });
});
afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});

async function candidate() {
	const workspace = await prepareFactoryWorkspace({
		sourceRoot,
		storageDir,
		taskId: "example-feature",
	});
	await writeFile(path.join(workspace.path, "feature.txt"), "after\n");
	const checkpoint = await checkpointFactoryWorkspace({ workspace });
	return {
		workspace,
		...checkpoint,
		storageDir,
		runId: "example-run",
		signal: new AbortController().signal,
	};
}

/**
 * Points origin at `https://github.com/example/project.git` (publishing needs a
 * GitHub origin), served by the bare repository at `bare`.
 */
async function githubOrigin(bare: string, repo = "example/project") {
	const url = `https://github.com/${repo}.git`;
	await exec("git", ["remote", "add", "origin", url], { cwd: sourceRoot });
	await exec("git", ["config", `url.${bare}.insteadOf`, url], {
		cwd: sourceRoot,
	});
}

describe("local feature factory", () => {
	it("honors a relative pre-commit hook and preserves a blocked candidate for retry", async () => {
		const hook = path.join(sourceRoot, ".hooks", "pre-commit");
		await mkdir(path.dirname(hook));
		await writeFile(
			hook,
			'#!/bin/sh\nmkdir -p evidence\nprintf "pre-commit\\n" >> evidence/hook-runs\nif [ ! -f evidence/allow-commit ]; then echo "candidate hook blocked" >&2; exit 1; fi\n',
		);
		await chmod(hook, 0o755);
		await exec("git", ["add", ".hooks"], { cwd: sourceRoot });
		await exec("git", ["commit", "-m", "Add hook fixture"], {
			cwd: sourceRoot,
		});
		await exec("git", ["config", "core.hooksPath", ".hooks"], {
			cwd: sourceRoot,
		});
		const workspace = await prepareFactoryWorkspace({
			sourceRoot,
			storageDir,
			taskId: "hook-candidate",
		});
		await writeFile(path.join(workspace.path, "feature.txt"), "after\n");
		await expect(checkpointFactoryWorkspace({ workspace })).rejects.toThrow(
			"candidate hook blocked",
		);
		expect(
			(
				await exec("git", ["rev-parse", "HEAD"], { cwd: workspace.path })
			).stdout.trim(),
		).toBe(workspace.baseCommit);
		expect(
			(await exec("git", ["status", "--porcelain"], { cwd: workspace.path }))
				.stdout,
		).toContain("M  feature.txt");
		expect(
			await readFile(path.join(workspace.path, "feature.txt"), "utf8"),
		).toBe("after\n");
		await writeFile(
			path.join(workspace.path, "evidence", "allow-commit"),
			"allowed\n",
		);
		const checkpoint = await checkpointFactoryWorkspace({ workspace });
		expect(checkpoint.candidateCommit).not.toBe(workspace.baseCommit);
		expect(checkpoint.diff).toContain("+after");
		expect(
			await readFile(
				path.join(workspace.path, "evidence", "hook-runs"),
				"utf8",
			),
		).toBe("pre-commit\npre-commit\n");
	});

	it("honors merge-hook rejection without treating it as a code conflict", async () => {
		const hook = path.join(sourceRoot, ".hooks", "pre-merge-commit");
		await mkdir(path.dirname(hook));
		await writeFile(
			hook,
			'#!/bin/sh\nmkdir -p evidence\nprintf "merge hook ran\\n" >> evidence/merge-hook\nif [ ! -f evidence/allow-merge ]; then echo "merge hook blocked" >&2; exit 1; fi\n',
		);
		await chmod(hook, 0o755);
		await exec("git", ["add", ".hooks"], { cwd: sourceRoot });
		await exec("git", ["commit", "-m", "Add merge hook fixture"], {
			cwd: sourceRoot,
		});
		await exec("git", ["config", "core.hooksPath", ".hooks"], {
			cwd: sourceRoot,
		});
		const target = await candidate();
		const unit = await prepareFactoryWorkspace({
			sourceRoot,
			storageDir,
			taskId: "merge-unit",
		});
		await writeFile(path.join(unit.path, "unit.txt"), "independent unit\n");
		const { candidateCommit } = await checkpointFactoryWorkspace({
			workspace: unit,
		});
		await expect(
			integrateFactoryCommit({
				workspace: target.workspace,
				commit: candidateCommit,
			}),
		).rejects.toThrow("merge hook blocked");
		expect(
			(
				await exec("git", ["rev-parse", "HEAD"], { cwd: target.workspace.path })
			).stdout.trim(),
		).toBe(target.candidateCommit);
		expect(
			(
				await exec("git", ["rev-parse", "MERGE_HEAD"], {
					cwd: target.workspace.path,
				})
			).stdout.trim(),
		).toBe(candidateCommit);
		await expect(
			integrateFactoryCommit({
				workspace: target.workspace,
				commit: candidateCommit,
			}),
		).rejects.toThrow("Pending integration has no recorded conflict repair");
		await exec("git", ["merge", "--abort"], { cwd: target.workspace.path });
		await writeFile(
			path.join(target.workspace.path, "evidence", "allow-merge"),
			"allowed\n",
		);
		await expect(
			integrateFactoryCommit({
				workspace: target.workspace,
				commit: candidateCommit,
			}),
		).resolves.toBe("merged");
		expect(
			await readFile(
				path.join(target.workspace.path, "evidence", "merge-hook"),
				"utf8",
			),
		).toBe("merge hook ran\nmerge hook ran\n");
	});

	it("reuses its task worktree and commits only its candidate", async () => {
		const input = await candidate();
		expect(input.diff).toContain("+after");
		expect(await readFile(path.join(sourceRoot, "feature.txt"), "utf8")).toBe(
			"before\n",
		);
		expect(
			await prepareFactoryWorkspace({
				sourceRoot,
				storageDir,
				taskId: "example-feature",
			}),
		).toEqual(input.workspace);
		await assertFactoryCandidate(input);
		await writeFile(
			path.join(input.workspace.path, "feature.txt"),
			"changed after check\n",
		);
		await expect(assertFactoryCandidate(input)).rejects.toThrow(
			"Candidate changed",
		);
	});

	it("names a new card's branch by its short id and title, and never renames an existing workspace's branch", async () => {
		expect(factoryBranchName(42, "Fix the login: redirect loop!")).toBe(
			"factory/f-42-fix-the-login-redirect-loop",
		);
		expect(
			factoryBranchName(
				7,
				"A very long title that keeps going well past forty characters",
			),
		).toBe("factory/f-7-a-very-long-title-that-keeps-going-well");
		expect(factoryBranchName(3, "!!!")).toBe("factory/f-3");
		const branchName = factoryBranchName(42, "Fix login");
		const fresh = await prepareFactoryWorkspace({
			sourceRoot,
			storageDir,
			taskId: "numbered",
			branchName,
		});
		expect(fresh.branch).toBe("factory/f-42-fix-login");
		await writeFile(path.join(fresh.path, "feature.txt"), "after\n");
		const checkpoint = await checkpointFactoryWorkspace({ workspace: fresh });
		await assertFactoryCandidate({ workspace: fresh, ...checkpoint });
		// Reopening reuses it, whatever name is offered now.
		expect(
			await prepareFactoryWorkspace({
				sourceRoot,
				storageDir,
				taskId: "numbered",
				branchName: factoryBranchName(42, "Renamed"),
			}),
		).toEqual(fresh);
		// A workspace created before short ids keeps its hashed branch.
		const legacy = await prepareFactoryWorkspace({
			sourceRoot,
			storageDir,
			taskId: "legacy",
		});
		expect(legacy.branch).toMatch(/^feat\/factory-[a-f0-9]{24}$/);
		expect(
			await prepareFactoryWorkspace({
				sourceRoot,
				storageDir,
				taskId: "legacy",
				branchName: factoryBranchName(5, "Legacy"),
			}),
		).toEqual(legacy);
		// A name another card's branch already holds falls back to the hashed one.
		const taken = await prepareFactoryWorkspace({
			sourceRoot,
			storageDir,
			taskId: "collides",
			branchName,
		});
		expect(taken.branch).toMatch(/^feat\/factory-[a-f0-9]{24}$/);
	});

	it("records real command exit status and bounded output", async () => {
		const input = await candidate();
		const results = await verifyFactoryChecks({
			...input,
			checks: [
				{
					name: "API route",
					command: "node -e 'process.stdout.write(\"ok\")'",
					kind: "api",
					artifacts: [],
				},
				{
					name: "failure",
					command:
						"node -e 'process.stdout.write(\"x\".repeat(100000));process.exitCode=3'",
					kind: "test",
					artifacts: [],
				},
			],
		});
		expect(results[0]).toMatchObject({
			status: "passed",
			exitCode: 0,
			output: "ok",
		});
		expect(results[1]).toMatchObject({ status: "failed", exitCode: 3 });
		expect(results[1]?.output.length).toBeLessThan(33_000);
		expect(results[1]?.output).toContain("[output truncated]");
	});

	it("recreates a missing worktree without losing its branch or frozen base", async () => {
		const input = await candidate();
		await exec("git", ["worktree", "remove", input.workspace.path], {
			cwd: sourceRoot,
		});
		await writeFile(
			path.join(sourceRoot, "new-file.txt"),
			"later source commit",
		);
		await exec("git", ["add", "."], { cwd: sourceRoot });
		await exec("git", ["commit", "-m", "Advance source branch"], {
			cwd: sourceRoot,
		});
		const restored = await prepareFactoryWorkspace({
			sourceRoot,
			storageDir,
			taskId: "example-feature",
		});
		expect(restored).toEqual(input.workspace);
		await assertFactoryCandidate({
			workspace: restored,
			candidateCommit: input.candidateCommit,
		});
	});

	it("copies fresh visual evidence and blocks missing or stale captures", async () => {
		const input = await candidate();
		const results = await verifyFactoryChecks({
			...input,
			checks: [
				{
					name: "screen",
					command: `node -e 'const fs=require("fs");fs.mkdirSync("evidence",{recursive:true});fs.writeFileSync("evidence/screen.png",Buffer.from("${png}","base64"))'`,
					kind: "ui",
					artifacts: ["evidence/screen.png"],
				},
				{
					name: "stale screen",
					command: "node -e ''",
					kind: "ui",
					artifacts: ["evidence/screen.png"],
				},
				{
					name: "missing recording",
					command: "node -e ''",
					kind: "ui",
					artifacts: ["evidence/missing.webm"],
				},
				{
					name: "no capture",
					command: "node -e ''",
					kind: "ui",
					artifacts: [],
				},
			],
		});
		expect(results.map((result) => result.status)).toEqual([
			"passed",
			"blocked",
			"blocked",
			"blocked",
		]);
		const artifact = results[0]?.artifacts[0];
		expect(artifact?.mimeType).toBe("image/png");
		expect(artifact?.path.startsWith(storageDir)).toBe(true);
		if (!artifact) throw new Error("Expected captured artifact");
		expect((await readFile(artifact.path)).toString("base64")).toBe(png);
	});

	it("rejects evidence symlinks escaping the worktree", async () => {
		const input = await candidate();
		await mkdir(path.join(input.workspace.path, "evidence"));
		await writeFile(path.join(root, "private.png"), "outside");
		await symlink(
			path.join(root, "private.png"),
			path.join(input.workspace.path, "evidence", "screen.png"),
		);
		const results = await verifyFactoryChecks({
			...input,
			checks: [
				{
					name: "screen",
					command: "node -e ''",
					kind: "ui",
					artifacts: ["evidence/screen.png"],
				},
			],
		});
		expect(results[0]?.status).toBe("blocked");
		expect(results[0]?.blockedBy).toBe("configuration");
		expect(results[0]?.output).toContain("inside the task worktree");
		expect(results[0]?.artifacts).toEqual([]);
	});

	it("passes test and API checks on their exit code and notes evidence it could not capture", async () => {
		const input = await candidate();
		const outside = path.join(root, "outside.log");
		const results = await verifyFactoryChecks({
			...input,
			checks: [
				{
					name: "unit",
					command: `node -e 'require("fs").writeFileSync(${JSON.stringify(outside)},"PASS");process.stdout.write("PASS ok")'`,
					kind: "test",
					artifacts: [outside, "evidence/missing.png"],
				},
				{
					name: "failing api",
					command: "node -e 'process.exitCode=2'",
					kind: "api",
					artifacts: [outside],
				},
			],
		});
		expect(results[0]).toMatchObject({
			status: "passed",
			output: "PASS ok",
			artifacts: [],
			limitations: [
				`artifact not captured: ${outside}: outside the task worktree`,
				"artifact not captured: evidence/missing.png: missing",
			],
		});
		expect(results[1]).toMatchObject({ status: "failed", exitCode: 2 });
		expect(results[1]?.limitations).toBeUndefined();
	});

	it("flags check artifacts that can never be worktree evidence", () => {
		const check = (artifacts: string[], kind: FactoryCheck["kind"] = "test") =>
			factoryCheckConfigurationFindings([
				{ name: "Behavior", command: "true", kind, artifacts },
			]);
		expect(check(["/tmp/run.log"])[0]).toContain(
			'artifact "/tmp/run.log" is an absolute path outside the task worktree',
		);
		expect(check(["../shared/shot.png"], "ui")[0]).toContain(
			"escapes the task worktree",
		);
		expect(check(["logs/run.log"], "ui")[0]).toContain(
			"is not a screenshot or recording",
		);
		// A test or API check is proven by its exit code: an in-worktree
		// non-media artifact is allowed and noted as a limitation at run time.
		expect(check(["coverage/report.json"])).toEqual([]);
		expect(check(["logs/run.log"], "api")).toEqual([]);
		expect(check(["/tmp/run.log"], "api")[0]).toContain("absolute path");
		expect(check(["../out/report.json"])[0]).toContain(
			"escapes the task worktree",
		);
		expect(check(["evidence/shot.png"], "ui")).toEqual([]);
		expect(check([])).toEqual([]);
	});

	it("rejects a check that changes the candidate even when it exits successfully", async () => {
		const input = await candidate();
		await expect(
			verifyFactoryChecks({
				...input,
				checks: [
					{
						name: "mutating test",
						command:
							'node -e \'require("fs").writeFileSync("feature.txt","mutated")\'',
						kind: "test",
						artifacts: [],
					},
				],
			}),
		).rejects.toThrow("Candidate changed");
	});

	it("returns stdout alone on request and reports the spawned pid", async () => {
		const onSpawn = vi.fn();
		const result = await runFactoryCommand({
			cwd: root,
			file: process.execPath,
			args: [
				"-e",
				'process.stderr.write("notice\\n"); process.stdout.write("{\\"ok\\":true}")',
			],
			captureStdout: true,
			onSpawn,
		});
		expect(result.stdout).toBe('{"ok":true}');
		expect(result.output).toContain("notice");
		expect(onSpawn).toHaveBeenCalledWith(expect.any(Number));
		const plain = await runFactoryCommand({
			cwd: root,
			file: process.execPath,
			args: ["-e", 'process.stdout.write("x")'],
		});
		expect(plain).not.toHaveProperty("stdout");
	});

	it("merges extra command variables over the hub environment", async () => {
		vi.stubEnv("FACTORY_TEST_INHERITED", "from hub");
		vi.stubEnv("FACTORY_TEST_OVERRIDDEN", "from hub");
		const print = [
			"-e",
			'process.stdout.write(["FACTORY_TEST_INHERITED","FACTORY_TEST_OVERRIDDEN","FACTORY_TEST_ADDED"].map((name) => process.env[name] ?? "-").join("|"))',
		];
		const merged = await runFactoryCommand({
			cwd: root,
			file: process.execPath,
			args: print,
			env: {
				FACTORY_TEST_OVERRIDDEN: "from command",
				FACTORY_TEST_ADDED: "added",
			},
		});
		expect(merged.output).toBe("from hub|from command|added");
		const inherited = await runFactoryCommand({
			cwd: root,
			file: process.execPath,
			args: print,
		});
		expect(inherited.output).toBe("from hub|from hub|-");
	});

	it("rewrites only the Factory evidence section of a PR description", async () => {
		const start = "<!-- cline-factory-evidence:start -->";
		const end = "<!-- cline-factory-evidence:end -->";
		const section = `${start}\nVerified\n${end}`;
		const workspace: FactoryWorkspace = {
			path: root,
			branch: "feat/factory-000000000000000000000000",
			baseBranch: "main",
			baseCommit: "base",
		};
		const url = "https://github.com/example/project/pull/1";
		const update = async (current: string) => {
			const edits: string[] = [];
			const run = vi.fn<typeof runFactoryCommand>(async (command) => {
				expect(command).toMatchObject({ cwd: root, file: "gh" });
				if (command.args[1] === "view") {
					expect(command.args).toEqual([
						"pr",
						"view",
						"1",
						"--repo",
						"example/project",
						"--json",
						"body",
					]);
					expect(command.captureStdout).toBe(true);
					// A gh notice on stderr must not break parsing.
					return {
						exitCode: 0,
						output: `A new release of gh is available.\n${JSON.stringify({ body: current })}`,
						stdout: JSON.stringify({ body: current }),
						truncated: false,
						timedOut: false,
					};
				}
				expect(command.args.slice(0, 6)).toEqual([
					"pr",
					"edit",
					"1",
					"--repo",
					"example/project",
					"--body-file",
				]);
				edits.push(await readFile(command.args[6] ?? "", "utf8"));
				return { exitCode: 0, output: "", truncated: false, timedOut: false };
			});
			await updateFactoryPullRequestBody({ workspace, url, section }, run);
			return edits;
		};
		expect(
			await update(
				`Why this change.\n\n${start}\nIn progress\n${end}\n\nHuman note`,
			),
		).toEqual([`Why this change.\n\n${section}\n\nHuman note`]);
		expect(await update("A human rewrote this.")).toEqual([
			`A human rewrote this.\n\n${section}`,
		]);
		expect(await update(`Intro\n\n${section}`)).toEqual([]);
		await expect(
			updateFactoryPullRequestBody({ workspace, url, section }, async () => ({
				exitCode: 1,
				output: "HTTP 404",
				truncated: false,
				timedOut: false,
			})),
		).rejects.toThrow("Could not read the PR description: HTTP 404");
	});

	it("times out commands and honors cancellation", async () => {
		const input = await candidate();
		const checks: FactoryCheck[] = [
			{
				name: "hang",
				command: "node -e 'setInterval(()=>{},1000)'",
				kind: "test",
				artifacts: [],
			},
		];
		const results = await verifyFactoryChecks({
			...input,
			checks,
			timeoutMs: 100,
		});
		expect(results[0]?.status).toBe("failed");
		expect(results[0]?.output).toContain("timed out");
		const abort = new AbortController();
		const pending = verifyFactoryChecks({
			...input,
			checks,
			signal: abort.signal,
		});
		setTimeout(() => abort.abort(), 100);
		await expect(pending).rejects.toThrow();
	});

	it.skipIf(process.platform === "win32")(
		"reconciles an ambiguous draft creation without duplicate publication",
		async () => {
			const input = await candidate();
			const remote = path.join(root, "remote.git");
			await exec("git", ["init", "--bare", remote]);
			await githubOrigin(remote);
			await exec("git", ["push", "origin", "main"], { cwd: sourceRoot });
			const bin = path.join(root, "bin");
			await mkdir(bin);
			const marker = path.join(root, "fake-pr.json");
			const calls = path.join(root, "create-calls.txt");
			const fakeGh = path.join(bin, "gh");
			await writeFile(
				fakeGh,
				`#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
const marker = ${JSON.stringify(marker)};
if (args[0] === "--version" || args[0] === "auth") {
} else if (args[1] === "list") {
  process.stdout.write(fs.existsSync(marker) ? fs.readFileSync(marker) : "[]");
} else if (args[1] === "create") {
  fs.appendFileSync(${JSON.stringify(calls)}, "create\\n");
  fs.writeFileSync(marker, JSON.stringify([{url:"https://github.com/example/project/pull/1",number:1,state:"OPEN",baseRefName:"main",headRefOid:${JSON.stringify(input.candidateCommit)}}]));
  process.exitCode = 1;
} else { process.exitCode = 2; }
`,
			);
			await chmod(fakeGh, 0o755);
			vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH ?? ""}`);
			const publication = {
				...input,
				title: "Feature",
				body: "Synthetic verification evidence.",
			};
			expect(await publishFactoryPullRequest(publication)).toBe(
				"https://github.com/example/project/pull/1",
			);
			expect(await publishFactoryPullRequest(publication)).toBe(
				"https://github.com/example/project/pull/1",
			);
			expect(await readFile(calls, "utf8")).toBe("create\n");
			const pushed = await exec(
				"git",
				["rev-parse", `refs/heads/${input.workspace.branch}`],
				{ cwd: remote },
			);
			expect(pushed.stdout.trim()).toBe(input.candidateCommit);
		},
	);

	describe("worktree base for a card that opens a PR", () => {
		const head = async (cwd: string, ref = "HEAD") =>
			(await exec("git", ["rev-parse", ref], { cwd })).stdout.trim();
		/** A bare origin holding main; returns its path. */
		async function origin() {
			const remotePath = path.join(root, "origin.git");
			await exec("git", ["init", "--bare", "-b", "main", remotePath]);
			await exec("git", ["remote", "add", "origin", remotePath], {
				cwd: sourceRoot,
			});
			await exec("git", ["push", "origin", "main"], { cwd: sourceRoot });
			return remotePath;
		}
		async function localCommit(file: string) {
			await writeFile(path.join(sourceRoot, file), `${file}\n`);
			await exec("git", ["add", "."], { cwd: sourceRoot });
			await exec("git", ["commit", "-m", file], { cwd: sourceRoot });
		}
		const prepare = (
			publish?: boolean,
			taskId = "base-card",
			baseBranch?: string,
		) =>
			prepareFactoryWorkspace({
				sourceRoot,
				storageDir,
				taskId,
				publish,
				baseBranch,
			});

		it("starts from the fetched remote default when the checked-out branch is unpublished", async () => {
			await origin();
			const published = await head(sourceRoot);
			await exec("git", ["checkout", "-b", "local-work"], { cwd: sourceRoot });
			await localCommit("local.txt");
			const workspace = await prepare(true);
			expect(workspace).toMatchObject({
				baseBranch: "main",
				baseCommit: published,
				baseSource: "remote_default",
			});
			expect(workspace.baseNote).toContain(
				"The project's checked-out branch local-work is not used",
			);
			expect(await head(workspace.path)).toBe(published);
		});

		it("starts from the remote default when the checked-out branch has unpushed commits", async () => {
			await origin();
			const published = await head(sourceRoot);
			await localCommit("unpushed.txt");
			const workspace = await prepare(true);
			expect(workspace).toMatchObject({
				baseBranch: "main",
				baseCommit: published,
				baseSource: "remote_default",
			});
			expect(workspace.baseNote).toContain(
				"Local-only changes are not included.",
			);
		});

		it("starts from the remote default even when the checked-out branch is published and up to date", async () => {
			await origin();
			const main = await head(sourceRoot);
			await exec("git", ["checkout", "-b", "cline/handoff-1"], {
				cwd: sourceRoot,
			});
			await localCommit("shared.txt");
			await exec("git", ["push", "origin", "cline/handoff-1"], {
				cwd: sourceRoot,
			});
			const workspace = await prepare(true);
			expect(workspace).toMatchObject({
				baseBranch: "main",
				baseCommit: main,
				baseSource: "remote_default",
			});
			expect(workspace.baseNote).toContain("origin's default branch main");
			expect(workspace.baseNote).toContain(
				"checked-out branch cline/handoff-1 is not used",
			);
		});

		it("starts from origin's tip of the default branch, not a stale local main", async () => {
			const remotePath = await origin();
			const clone = path.join(root, "other-clone");
			await exec("git", ["clone", remotePath, clone]);
			await exec("git", ["config", "user.email", "o@example.test"], {
				cwd: clone,
			});
			await exec("git", ["config", "user.name", "Other"], { cwd: clone });
			await writeFile(path.join(clone, "upstream.txt"), "upstream\n");
			await exec("git", ["add", "."], { cwd: clone });
			await exec("git", ["commit", "-m", "Upstream"], { cwd: clone });
			await exec("git", ["push", "origin", "main"], { cwd: clone });
			const workspace = await prepare(true);
			expect(workspace.baseCommit).toBe(await head(clone));
			expect(workspace.baseCommit).not.toBe(await head(sourceRoot));
		});

		it("starts from the base branch the card names, at its remote tip", async () => {
			await origin();
			await exec("git", ["checkout", "-b", "release"], { cwd: sourceRoot });
			await localCommit("release.txt");
			await exec("git", ["push", "origin", "release"], { cwd: sourceRoot });
			const release = await head(sourceRoot);
			await exec("git", ["checkout", "main"], { cwd: sourceRoot });
			const workspace = await prepare(true, "named-base", "release");
			expect(workspace).toMatchObject({
				baseBranch: "release",
				baseCommit: release,
				baseSource: "remote_default",
			});
			expect(workspace.baseNote).toContain(
				"release, the base branch this card names",
			);
		});

		it("stops a card whose named base branch is not on origin", async () => {
			await origin();
			const failure = prepare(true, "missing-base", "nowhere");
			await expect(failure).rejects.toBeInstanceOf(FactoryPublishError);
			await expect(failure).rejects.toThrow(
				"The card's base branch nowhere is not on origin",
			);
		});

		it("keeps the local HEAD for a card that does not publish", async () => {
			await origin();
			await localCommit("local.txt");
			const workspace = await prepare(false);
			expect(workspace).toMatchObject({
				baseBranch: "main",
				baseCommit: await head(sourceRoot),
				baseSource: "local_head",
			});
		});

		it("keeps the recorded base of an existing workspace", async () => {
			const first = await prepare(false);
			await origin();
			await localCommit("later.txt");
			expect(await prepare(true)).toEqual(first);
		});

		it("stops a publishing card without an origin remote before creating a worktree", async () => {
			const failure = prepare(true);
			await expect(failure).rejects.toBeInstanceOf(FactoryPublishError);
			await expect(failure).rejects.toThrow(
				"This project has no origin remote",
			);
			const worktrees = (
				await exec("git", ["worktree", "list"], { cwd: sourceRoot })
			).stdout.trim();
			expect(worktrees.split("\n")).toHaveLength(1);
		});
	});

	describe.skipIf(process.platform === "win32")("draft PR base", () => {
		/** A bare origin and a fake gh; `create` fails with `createError` when set. */
		async function remote(
			options: {
				gh?: { version?: number; auth?: number; createError?: string };
				origin?: boolean;
			} = {},
		) {
			const input = await candidate();
			const remotePath = path.join(root, "remote.git");
			await exec("git", ["init", "--bare", "-b", "main", remotePath]);
			if (options.origin !== false) await githubOrigin(remotePath);
			const bin = path.join(root, "bin");
			await mkdir(bin);
			const marker = path.join(root, "fake-pr.json");
			const calls = path.join(root, "gh-calls.txt");
			await writeFile(
				path.join(bin, "gh"),
				`#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, args.join(" ") + "\\n");
const marker = ${JSON.stringify(marker)};
if (args[0] === "--version") process.exitCode = ${options.gh?.version ?? 0};
else if (args[0] === "auth") process.exitCode = ${options.gh?.auth ?? 0};
else if (args[1] === "list") process.stdout.write(fs.existsSync(marker) ? fs.readFileSync(marker) : "[]");
else if (args[1] === "create") {
  const error = ${JSON.stringify(options.gh?.createError ?? "")};
  if (error) { process.stderr.write(error + "\\nmore detail\\n"); process.exitCode = 1; }
  else fs.writeFileSync(marker, JSON.stringify([{url:"https://github.com/example/project/pull/2",number:2,state:"OPEN",baseRefName:"main",headRefOid:${JSON.stringify(input.candidateCommit)}}]));
} else process.exitCode = 2;
`,
			);
			await chmod(path.join(bin, "gh"), 0o755);
			vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH ?? ""}`);
			const branches = async () =>
				(await exec("git", ["branch", "--list"], { cwd: remotePath })).stdout;
			const ghCalls = async () =>
				(await readFile(calls, "utf8").catch(() => "")).split("\n");
			return {
				publication: {
					...input,
					title: "Feature",
					body: "Synthetic verification evidence.",
				},
				remotePath,
				branches,
				ghCalls,
			};
		}

		it("refuses an unpublished base branch before pushing anything", async () => {
			const r = await remote();
			await expect(publishFactoryPullRequest(r.publication)).rejects.toThrow(
				new FactoryPublishError(
					"The base branch main is not on GitHub and has unpublished commits. Push it, or start this work from a published branch.",
				),
			);
			expect(await r.branches()).toBe("");
		});

		it("targets the remote default branch when the local base has nothing unpublished", async () => {
			const r = await remote();
			await exec("git", ["push", "origin", "main:refs/heads/trunk"], {
				cwd: sourceRoot,
			});
			await exec("git", ["symbolic-ref", "HEAD", "refs/heads/trunk"], {
				cwd: r.remotePath,
			});
			await expect(
				resolveFactoryPullRequestBase({
					workspace: { ...r.publication.workspace, baseBranch: "local-only" },
				}),
			).resolves.toBe("trunk");
			// A local commit the default branch lacks is unpublished work.
			await writeFile(path.join(sourceRoot, "local.txt"), "local\n");
			await exec("git", ["add", "."], { cwd: sourceRoot });
			await exec("git", ["commit", "-m", "Local only"], { cwd: sourceRoot });
			const local = await prepareFactoryWorkspace({
				sourceRoot,
				storageDir,
				taskId: "local-base",
			});
			await expect(
				resolveFactoryPullRequestBase({
					workspace: { ...local, baseBranch: "local-only" },
				}),
			).rejects.toBeInstanceOf(FactoryPublishError);
		});

		it("reports gh's own reason when the draft PR cannot be created", async () => {
			const r = await remote({
				gh: {
					createError:
						"pull request create failed: GraphQL: Base ref must be a branch (createPullRequest)",
				},
			});
			await exec("git", ["push", "origin", "main"], { cwd: sourceRoot });
			const failure = publishFactoryPullRequest(r.publication);
			await expect(failure).rejects.toBeInstanceOf(FactoryPublishError);
			await expect(failure).rejects.toThrow(
				"Could not open the draft PR: pull request create failed: GraphQL: Base ref must be a branch (createPullRequest)",
			);
		});

		it.each([
			[{ origin: false }, "This project has no origin remote"],
			[{ gh: { version: 1 } }, "The GitHub CLI (gh) is not installed"],
			[{ gh: { auth: 1 } }, "The GitHub CLI is not signed in"],
		] as const)("stops with a one-sentence fix (%o)", async (options, reason) => {
			const r = await remote(options);
			const failure = resolveFactoryPullRequestBase(r.publication);
			await expect(failure).rejects.toBeInstanceOf(FactoryPublishError);
			await expect(failure).rejects.toThrow(reason);
		});
	});

	it.skipIf(process.platform === "win32")(
		"cleans up background descendants after a successful check",
		async () => {
			const input = await candidate();
			const results = await verifyFactoryChecks({
				...input,
				checks: [
					{
						name: "background process",
						command: "node -e 'setInterval(()=>{},1000)' & echo $!",
						kind: "test",
						artifacts: [],
					},
				],
			});
			expect(results[0]?.status).toBe("passed");
			const pid = Number(results[0]?.output.trim());
			expect(pid).toBeGreaterThan(0);
			expect(() => process.kill(pid, 0)).toThrow();
		},
	);
});
