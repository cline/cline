import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	copyFile,
	mkdir,
	mkdtemp,
	open,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	type FactoryArtifact,
	type FactoryCheck,
	type FactoryCheckResult,
	type FactoryWorkspace,
	factoryWorkspaceSchema,
} from "@cline/shared";
import { z } from "zod";

const OUTPUT_BYTES = 32_768;
const DIFF_BYTES = 250_000;
const CHECK_TIMEOUT_MS = 10 * 60_000;

function key(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

async function command(input: {
	cwd: string;
	file: string;
	args: string[];
	signal?: AbortSignal;
	timeoutMs?: number;
	maxBytes?: number;
}): Promise<{
	exitCode: number | null;
	output: string;
	truncated: boolean;
	timedOut: boolean;
}> {
	input.signal?.throwIfAborted();
	const child = spawn(input.file, input.args, {
		cwd: input.cwd,
		stdio: ["ignore", "pipe", "pipe"],
		detached: process.platform !== "win32",
		windowsHide: true,
	});
	const chunks: Buffer[] = [];
	let bytes = 0;
	let truncated = false;
	let timedOut = false;
	const collect = (chunk: Buffer) => {
		const remaining = (input.maxBytes ?? OUTPUT_BYTES) - bytes;
		if (chunk.length > remaining) truncated = true;
		if (remaining > 0) {
			const kept = chunk.subarray(0, remaining);
			chunks.push(kept);
			bytes += kept.length;
		}
	};
	child.stdout.on("data", collect);
	child.stderr.on("data", collect);
	const kill = () => {
		if (!child.pid) return;
		if (process.platform === "win32") {
			const killer = spawn(
				"taskkill",
				["/pid", String(child.pid), "/T", "/F"],
				{ stdio: "ignore", windowsHide: true },
			);
			killer.on("error", () => child.kill("SIGKILL"));
			killer.unref();
		} else {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {
				child.kill("SIGKILL");
			}
		}
	};
	input.signal?.addEventListener("abort", kill, { once: true });
	const timer = setTimeout(() => {
		timedOut = true;
		kill();
	}, input.timeoutMs ?? 60_000);
	try {
		const exitCode = await new Promise<number | null>((resolve, reject) => {
			child.once("error", reject);
			child.once("exit", () => {
				// Checks may leave a server holding the pipes after their shell exits.
				kill();
			});
			child.once("close", resolve);
		});
		input.signal?.throwIfAborted();
		return {
			exitCode,
			output: Buffer.concat(chunks).toString("utf8"),
			truncated,
			timedOut,
		};
	} finally {
		clearTimeout(timer);
		input.signal?.removeEventListener("abort", kill);
	}
}

async function git(input: {
	cwd: string;
	args: string[];
	signal?: AbortSignal;
	maxBytes?: number;
}): Promise<string> {
	const result = await command({ ...input, file: "git" });
	if (result.exitCode !== 0 || result.timedOut)
		throw new Error(`Git ${input.args[0]} failed: ${result.output}`);
	if (result.truncated)
		throw new Error(
			"Git output exceeds the factory review limit; split this feature into smaller tasks.",
		);
	return result.output.trim();
}

async function assertOwnedWorkspace(
	workspace: FactoryWorkspace,
	signal?: AbortSignal,
): Promise<void> {
	if (!/^feat\/factory-[a-f0-9]{24}$/.test(workspace.branch))
		throw new Error("Factory requires its task-owned branch.");
	const branch = await git({
		cwd: workspace.path,
		args: ["symbolic-ref", "--short", "HEAD"],
		signal,
	});
	if (branch !== workspace.branch)
		throw new Error(
			"Factory worktree branch changed; refusing to modify or publish it.",
		);
	await git({
		cwd: workspace.path,
		args: ["merge-base", "--is-ancestor", workspace.baseCommit, "HEAD"],
		signal,
	});
}

export async function prepareFactoryWorkspace(input: {
	sourceRoot: string;
	taskId: string;
	storageDir: string;
	signal?: AbortSignal;
}): Promise<FactoryWorkspace> {
	const sourceRoot = await realpath(input.sourceRoot);
	const id = key(`${sourceRoot}\0${input.taskId}`);
	const root = path.join(input.storageDir, "factory-worktrees", id);
	const manifest = path.join(root, "workspace.json");
	let workspace: FactoryWorkspace;
	try {
		workspace = factoryWorkspaceSchema.parse(
			JSON.parse(await readFile(manifest, "utf8")),
		);
		if (
			workspace.path !== path.join(root, "repo") ||
			workspace.branch !== `feat/factory-${id}`
		)
			throw new Error("Factory workspace ownership does not match its task.");
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			throw error;
		const baseBranch = await git({
			cwd: sourceRoot,
			args: ["symbolic-ref", "--short", "HEAD"],
			signal: input.signal,
		});
		const baseCommit = await git({
			cwd: sourceRoot,
			args: ["rev-parse", "HEAD"],
			signal: input.signal,
		});
		workspace = {
			path: path.join(root, "repo"),
			branch: `feat/factory-${id}`,
			baseBranch,
			baseCommit,
		};
		await mkdir(root, { recursive: true });
		await writeFile(manifest, JSON.stringify(workspace), { flag: "wx" });
	}
	try {
		await stat(workspace.path);
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			throw error;
		const branch = await command({
			cwd: sourceRoot,
			file: "git",
			args: [
				"show-ref",
				"--verify",
				"--quiet",
				`refs/heads/${workspace.branch}`,
			],
			signal: input.signal,
		});
		if (branch.exitCode !== 0 && branch.exitCode !== 1)
			throw new Error("Could not inspect the task branch.");
		await git({
			cwd: sourceRoot,
			args:
				branch.exitCode === 0
					? ["worktree", "add", workspace.path, workspace.branch]
					: [
							"worktree",
							"add",
							"-b",
							workspace.branch,
							workspace.path,
							workspace.baseCommit,
						],
			signal: input.signal,
		});
	}
	await assertOwnedWorkspace(workspace, input.signal);
	return workspace;
}

export async function assertFactoryCandidate(input: {
	workspace: FactoryWorkspace;
	candidateCommit: string;
	signal?: AbortSignal;
}): Promise<void> {
	await assertOwnedWorkspace(input.workspace, input.signal);
	const head = await git({
		cwd: input.workspace.path,
		args: ["rev-parse", "HEAD"],
		signal: input.signal,
	});
	const status = await git({
		cwd: input.workspace.path,
		args: ["status", "--porcelain", "--untracked-files=all"],
		signal: input.signal,
	});
	if (head !== input.candidateCommit || status)
		throw new Error(
			"Candidate changed after verification began. Commit the changes and rerun checks and review. Keep generated evidence in a gitignored directory.",
		);
}

export async function checkpointFactoryWorkspace(input: {
	workspace: FactoryWorkspace;
	signal?: AbortSignal;
}): Promise<{ candidateCommit: string; diff: string }> {
	await assertOwnedWorkspace(input.workspace, input.signal);
	const options = { cwd: input.workspace.path, signal: input.signal };
	await git({ ...options, args: ["add", "--all"] });
	const staged = await git({
		...options,
		args: ["diff", "--cached", "--name-only"],
	});
	if (staged)
		await git({
			...options,
			args: [
				"-c",
				"core.hooksPath=/dev/null",
				"commit",
				"-m",
				"Implement feature task",
			],
		});
	const candidateCommit = await git({
		...options,
		args: ["rev-parse", "HEAD"],
	});
	await assertFactoryCandidate({ ...input, candidateCommit });
	const diff = await git({
		...options,
		args: [
			"diff",
			"--no-ext-diff",
			"--no-textconv",
			"--binary",
			input.workspace.baseCommit,
			candidateCommit,
		],
		maxBytes: DIFF_BYTES,
	});
	if (!diff) throw new Error("The feature task produced no changes to review.");
	return { candidateCommit, diff };
}

function mimeType(extension: string): string | undefined {
	switch (extension.toLowerCase()) {
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		case ".mp4":
			return "video/mp4";
		case ".webm":
			return "video/webm";
		default:
			return undefined;
	}
}

async function artifactVersion(file: string): Promise<string | undefined> {
	try {
		const metadata = await stat(file, { bigint: true });
		return `${metadata.mtimeNs}:${metadata.ctimeNs}:${metadata.size}`;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return undefined;
		throw error;
	}
}

async function collectArtifact(input: {
	declaredPath: string;
	cwd: string;
	artifactDir: string;
	previousVersion: string | undefined;
}): Promise<FactoryArtifact> {
	const cwd = await realpath(input.cwd);
	const source = await realpath(path.resolve(cwd, input.declaredPath));
	const relative = path.relative(cwd, source);
	if (
		!relative ||
		relative.startsWith(`..${path.sep}`) ||
		relative === ".." ||
		path.isAbsolute(relative)
	)
		throw new Error("Evidence must be inside the task worktree.");
	const metadata = await stat(source);
	const mime = mimeType(path.extname(source));
	if (
		!metadata.isFile() ||
		!mime ||
		metadata.size === 0 ||
		metadata.size > 50 * 1024 * 1024
	)
		throw new Error(
			"Evidence must be a nonempty PNG, JPEG, WebP, MP4, or WebM file no larger than 50 MB.",
		);
	if ((await artifactVersion(source)) === input.previousVersion)
		throw new Error(
			`Evidence was not refreshed by this check: ${input.declaredPath}`,
		);
	const file = await open(source, "r");
	try {
		const header = Buffer.alloc(12);
		await file.read(header, 0, header.length, 0);
		const valid =
			mime === "image/png"
				? header
						.subarray(0, 8)
						.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
				: mime === "image/jpeg"
					? header[0] === 255 && header[1] === 216 && header[2] === 255
					: mime === "image/webp"
						? header.toString("ascii", 0, 4) === "RIFF" &&
							header.toString("ascii", 8, 12) === "WEBP"
						: mime === "video/mp4"
							? header.toString("ascii", 4, 8) === "ftyp"
							: header.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
		if (!valid)
			throw new Error(
				`Evidence content does not match its media type: ${input.declaredPath}`,
			);
	} finally {
		await file.close();
	}
	await mkdir(input.artifactDir, { recursive: true });
	const destination = path.join(
		input.artifactDir,
		`${randomUUID()}${path.extname(source)}`,
	);
	await copyFile(source, destination);
	return { label: input.declaredPath, path: destination, mimeType: mime };
}

export async function verifyFactoryChecks(input: {
	checks: FactoryCheck[];
	workspace: FactoryWorkspace;
	candidateCommit: string;
	storageDir: string;
	runId: string;
	signal: AbortSignal;
	timeoutMs?: number;
}): Promise<FactoryCheckResult[]> {
	const results: FactoryCheckResult[] = [];
	for (const check of input.checks) {
		await assertFactoryCandidate(input);
		const result: FactoryCheckResult = {
			name: check.name,
			kind: check.kind,
			command: check.command,
			status: "blocked",
			exitCode: null,
			output: "",
			artifacts: [],
		};
		results.push(result);
		if (check.kind === "ui" && check.artifacts.length === 0) {
			result.output =
				"UI checks require declared screenshot or recording paths.";
			continue;
		}
		const previousVersions = await Promise.all(
			check.artifacts.map((file) =>
				artifactVersion(path.resolve(input.workspace.path, file)),
			),
		);
		const run = await command({
			cwd: input.workspace.path,
			file: process.platform === "win32" ? "cmd.exe" : "/bin/sh",
			args:
				process.platform === "win32"
					? ["/d", "/s", "/c", check.command]
					: ["-c", check.command],
			signal: input.signal,
			timeoutMs: input.timeoutMs ?? CHECK_TIMEOUT_MS,
		});
		result.exitCode = run.exitCode;
		result.output =
			run.output +
			(run.truncated ? "\n[output truncated]" : "") +
			(run.timedOut ? "\nCheck timed out." : "");
		result.status = run.exitCode === 0 && !run.timedOut ? "passed" : "failed";
		await assertFactoryCandidate(input);
		if (result.status === "passed") {
			try {
				for (const [index, declaredPath] of check.artifacts.entries())
					result.artifacts.push(
						await collectArtifact({
							declaredPath,
							cwd: input.workspace.path,
							artifactDir: path.join(
								input.storageDir,
								"factory-artifacts",
								key(input.runId),
							),
							previousVersion: previousVersions[index],
						}),
					);
			} catch (error) {
				result.status = "blocked";
				result.output += `\n${error instanceof Error ? error.message : String(error)}`;
			}
		}
	}
	return results;
}

export async function publishFactoryPullRequest(input: {
	workspace: FactoryWorkspace;
	candidateCommit: string;
	title: string;
	body: string;
	signal?: AbortSignal;
}): Promise<string> {
	await assertFactoryCandidate(input);
	const cwd = input.workspace.path;
	const existing = async () => {
		const result = await command({
			cwd,
			file: "gh",
			args: [
				"pr",
				"list",
				"--state",
				"open",
				"--head",
				input.workspace.branch,
				"--base",
				input.workspace.baseBranch,
				"--json",
				"url,headRefOid",
			],
			signal: input.signal,
		});
		if (result.exitCode !== 0 || result.timedOut || result.truncated)
			throw new Error("Could not check for an existing feature PR.");
		const matches = z
			.array(z.object({ url: z.string().url(), headRefOid: z.string() }))
			.parse(JSON.parse(result.output));
		return matches.find((entry) => entry.headRefOid === input.candidateCommit)
			?.url;
	};
	await git({
		cwd,
		args: [
			"push",
			"origin",
			`${input.candidateCommit}:refs/heads/${input.workspace.branch}`,
		],
		signal: input.signal,
	});
	await assertFactoryCandidate(input);
	const prior = await existing();
	if (prior) return prior;
	const temp = await mkdtemp(path.join(tmpdir(), "cline-factory-pr-"));
	try {
		const bodyFile = path.join(temp, "body.txt");
		await writeFile(bodyFile, input.body);
		await command({
			cwd,
			file: "gh",
			args: [
				"pr",
				"create",
				"--draft",
				"--head",
				input.workspace.branch,
				"--base",
				input.workspace.baseBranch,
				"--title",
				input.title,
				"--body-file",
				bodyFile,
			],
			signal: input.signal,
		});
		const created = await existing();
		if (!created)
			throw new Error(
				"Could not confirm the draft PR. Retry to reconcile publication before creating another.",
			);
		return created;
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
}
