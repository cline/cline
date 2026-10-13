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
import type { FactoryCheck } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	assertFactoryCandidate,
	checkpointFactoryWorkspace,
	prepareFactoryWorkspace,
	publishFactoryPullRequest,
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

describe("local feature factory", () => {
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
		expect(results[0]?.output).toContain("inside the task worktree");
		expect(results[0]?.artifacts).toEqual([]);
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
			await exec("git", ["remote", "add", "origin", remote], {
				cwd: sourceRoot,
			});
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
if (args[1] === "list") {
  process.stdout.write(fs.existsSync(marker) ? fs.readFileSync(marker) : "[]");
} else if (args[1] === "create") {
  fs.appendFileSync(${JSON.stringify(calls)}, "create\\n");
  fs.writeFileSync(marker, JSON.stringify([{url:"https://github.com/example/project/pull/1",headRefOid:${JSON.stringify(input.candidateCommit)}}]));
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
