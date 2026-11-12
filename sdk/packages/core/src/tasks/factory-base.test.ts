import { execFile } from "node:child_process";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FactoryPublishError } from "./factory-errors";
import {
	chooseFactoryPublishBase,
	prepareFactoryWorkspace,
	resolveFactoryPullRequestBase,
	runFactoryCommand,
} from "./factory-local";

const exec = promisify(execFile);
let root: string;
let sourceRoot: string;
let originPath: string;

const git = async (cwd: string, ...args: string[]) =>
	(await exec("git", args, { cwd })).stdout.trim();

async function commit(cwd: string, file: string) {
	await writeFile(path.join(cwd, file), `${file}\n`);
	await git(cwd, "add", ".");
	await git(cwd, "commit", "-q", "-m", file);
	return git(cwd, "rev-parse", "HEAD");
}

/** Factory-owned refs left in the source repository. */
const factoryRefs = () =>
	git(sourceRoot, "for-each-ref", "--format=%(refname)", "refs/factory");

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), "factory-base-test-"));
	sourceRoot = path.join(root, "source");
	originPath = path.join(root, "origin.git");
	await mkdir(sourceRoot);
	await git(sourceRoot, "init", "-q", "-b", "main");
	await git(sourceRoot, "config", "user.email", "factory@example.test");
	await git(sourceRoot, "config", "user.name", "Factory Test");
	await commit(sourceRoot, "feature.txt");
	await git(root, "init", "-q", "--bare", "-b", "main", originPath);
	await git(sourceRoot, "remote", "add", "origin", originPath);
	await git(sourceRoot, "push", "-q", "origin", "main");
	// An unrelated branch whose tip differs from main's.
	await git(sourceRoot, "checkout", "-q", "-b", "other");
	await commit(sourceRoot, "other.txt");
	await git(sourceRoot, "push", "-q", "origin", "other");
	await git(sourceRoot, "checkout", "-q", "main");
});
afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});

describe("publish base from origin", () => {
	it("starts from origin's default branch while unrelated fetches rewrite FETCH_HEAD", async () => {
		const main = await git(originPath, "rev-parse", "refs/heads/main");
		const other = await git(originPath, "rev-parse", "refs/heads/other");
		await git(sourceRoot, "fetch", "-q", "origin", "other");
		let fetching = true;
		// What a concurrent card or an IDE's auto-fetch does to the checkout.
		const background = (async () => {
			let rounds = 0;
			while (fetching || rounds < 2) {
				await git(sourceRoot, "fetch", "-q", "origin", "other");
				rounds++;
			}
			return rounds;
		})();
		try {
			const workspaces = await Promise.all(
				["card-a", "card-b", "card-c"].map((taskId) =>
					prepareFactoryWorkspace({
						sourceRoot,
						storageDir: path.join(root, "storage"),
						taskId,
						publish: true,
					}),
				),
			);
			for (const workspace of workspaces) {
				expect(workspace).toMatchObject({
					baseBranch: "main",
					baseCommit: main,
					baseSource: "remote_default",
				});
				expect(await git(workspace.path, "rev-parse", "HEAD")).toBe(main);
			}
		} finally {
			fetching = false;
		}
		expect(await background).toBeGreaterThanOrEqual(2);
		expect(
			(await readFile(path.join(sourceRoot, ".git", "FETCH_HEAD"), "utf8"))
				.split("\t")[0]
				?.trim(),
		).toBe(other);
		expect(await factoryRefs()).toBe("");
	});

	it("leaves the checkout's FETCH_HEAD, branches and remote-tracking refs untouched", async () => {
		await git(sourceRoot, "fetch", "-q", "origin", "other");
		const fetchHead = path.join(sourceRoot, ".git", "FETCH_HEAD");
		const before = {
			content: await readFile(fetchHead, "utf8"),
			mtime: (await stat(fetchHead)).mtimeMs,
			refs: await git(sourceRoot, "for-each-ref"),
		};
		// origin moves on after the checkout last fetched.
		const clone = path.join(root, "clone");
		await git(root, "clone", "-q", originPath, clone);
		await git(clone, "config", "user.email", "o@example.test");
		await git(clone, "config", "user.name", "Other");
		const upstream = await commit(clone, "upstream.txt");
		await git(clone, "push", "-q", "origin", "main");

		const chosen = await chooseFactoryPublishBase({ sourceRoot });
		expect(chosen).toMatchObject({ baseBranch: "main", baseCommit: upstream });
		expect(chosen.baseRef).toBeUndefined();
		const named = await chooseFactoryPublishBase({
			sourceRoot,
			baseBranch: "other",
		});
		expect(named.baseCommit).toBe(
			await git(originPath, "rev-parse", "refs/heads/other"),
		);
		const workspace = await prepareFactoryWorkspace({
			sourceRoot,
			storageDir: path.join(root, "storage"),
			taskId: "untouched",
			publish: true,
		});
		expect(workspace.baseCommit).toBe(upstream);

		expect(await readFile(fetchHead, "utf8")).toBe(before.content);
		expect((await stat(fetchHead)).mtimeMs).toBe(before.mtime);
		// Only the task's own branch was added; origin/main was not updated.
		const after = (await git(sourceRoot, "for-each-ref"))
			.split("\n")
			.filter((line) => !line.endsWith(`refs/heads/${workspace.branch}`))
			.join("\n");
		expect(after).toBe(before.refs);
		expect(await factoryRefs()).toBe("");
	});

	it("keeps the fetched base in a Factory-owned ref only when asked to", async () => {
		const held = await chooseFactoryPublishBase({
			sourceRoot,
			keepBaseRef: true,
		});
		expect(held.baseRef).toMatch(/^refs\/factory\/base\/[0-9a-f-]{36}$/);
		expect(await git(sourceRoot, "rev-parse", held.baseRef ?? "")).toBe(
			held.baseCommit,
		);
		await git(sourceRoot, "update-ref", "-d", held.baseRef ?? "");
	});

	it.skipIf(process.platform === "win32")(
		"checks the PR base against origin's exact tip without FETCH_HEAD",
		async () => {
			const bin = path.join(root, "bin");
			await mkdir(bin);
			await writeFile(path.join(bin, "gh"), "#!/bin/sh\nexit 0\n");
			await chmod(path.join(bin, "gh"), 0o755);
			vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH ?? ""}`);
			await git(
				sourceRoot,
				"remote",
				"set-url",
				"origin",
				"https://github.com/example/project.git",
			);
			await git(
				sourceRoot,
				"config",
				`url.${originPath}.insteadOf`,
				"https://github.com/example/project.git",
			);
			const workspace = await prepareFactoryWorkspace({
				sourceRoot,
				storageDir: path.join(root, "storage"),
				taskId: "pr-base",
			});
			// FETCH_HEAD names a branch whose history does not contain the base.
			await git(sourceRoot, "fetch", "-q", "origin", "other");
			const fetchHead = await readFile(
				path.join(sourceRoot, ".git", "FETCH_HEAD"),
				"utf8",
			);
			await git(originPath, "symbolic-ref", "HEAD", "refs/heads/main");
			await expect(
				resolveFactoryPullRequestBase({
					workspace: { ...workspace, baseBranch: "local-only" },
				}),
			).resolves.toBe("main");
			expect(
				await readFile(path.join(sourceRoot, ".git", "FETCH_HEAD"), "utf8"),
			).toBe(fetchHead);
			expect(await factoryRefs()).toBe("");
			// A local commit main lacks is unpublished, whatever FETCH_HEAD says.
			await git(sourceRoot, "checkout", "-q", "other");
			const local = await prepareFactoryWorkspace({
				sourceRoot,
				storageDir: path.join(root, "storage"),
				taskId: "pr-base-other",
			});
			await expect(
				resolveFactoryPullRequestBase({
					workspace: { ...local, baseBranch: "local-only" },
				}),
			).rejects.toThrow(
				"The base branch local-only is not on GitHub and has unpublished commits.",
			);
			expect(await factoryRefs()).toBe("");
		},
	);
});

describe("non-interactive git and gh", () => {
	it("runs git and gh with prompts disabled, over the caller's variables", async () => {
		const result = await runFactoryCommand({
			cwd: sourceRoot,
			file: "git",
			args: ["-c", "alias.show-env=!env", "show-env"],
			env: { FACTORY_TEST_MARKER: "kept" },
			captureStdout: true,
		});
		const env = Object.fromEntries(
			(result.stdout ?? "")
				.split("\n")
				.map((line) => [
					line.slice(0, line.indexOf("=")),
					line.slice(line.indexOf("=") + 1),
				]),
		);
		expect(env).toMatchObject({
			GIT_TERMINAL_PROMPT: "0",
			GIT_ASKPASS: "",
			GCM_INTERACTIVE: "never",
			GH_PROMPT_DISABLED: "1",
			FACTORY_TEST_MARKER: "kept",
		});
	});

	describe("an origin that asks for credentials", () => {
		let server: Server;
		beforeEach(async () => {
			server = createServer((_request, response) => {
				response.writeHead(401, {
					"WWW-Authenticate": 'Basic realm="factory-test"',
				});
				response.end();
			});
			await new Promise<void>((resolve) =>
				server.listen(0, "127.0.0.1", resolve),
			);
			const { port } = server.address() as AddressInfo;
			await git(
				sourceRoot,
				"remote",
				"set-url",
				"origin",
				`http://127.0.0.1:${port}/example/project.git`,
			);
			// No credential helper from the developer's own configuration.
			vi.stubEnv("GIT_CONFIG_GLOBAL", path.join(root, "no-global-config"));
			vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
			vi.stubEnv("GIT_ASKPASS", "/bin/false");
			vi.stubEnv("SSH_ASKPASS", "/bin/false");
		});
		afterEach(async () => {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		});

		it("fails with a one-sentence fix instead of waiting for a prompt", async () => {
			const started = Date.now();
			const failure = chooseFactoryPublishBase({ sourceRoot });
			await expect(failure).rejects.toBeInstanceOf(FactoryPublishError);
			await expect(failure).rejects.toThrow(
				"Git could not sign in to origin without a prompt; set up a credential helper or SSH key for origin that works without one, then try again.",
			);
			expect(Date.now() - started).toBeLessThan(10_000);
			expect(await factoryRefs()).toBe("");
		});
	});
});
