import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	applyPatchInputPaths,
	classifyToolEnvironment,
	collectRecordedEnv,
	commandResultFacts,
	hashFileFact,
	readFilesInputPaths,
	toolEnvironmentTargetPaths,
} from "./tool-environment";

describe("tool environment facts", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "tool-env-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("classifies the tools whose environment is recorded", () => {
		expect(classifyToolEnvironment("read_files")).toBe("read");
		expect(classifyToolEnvironment("editor")).toBe("edit");
		expect(classifyToolEnvironment("apply_patch")).toBe("patch");
		expect(classifyToolEnvironment("run_commands")).toBe("command");
		expect(classifyToolEnvironment("search_codebase")).toBeUndefined();
	});

	it("collects read paths across input aliases, ignoring other strings", () => {
		expect(
			readFilesInputPaths({
				files: [{ path: "a.ts", start_line: 1 }, { path: "b.ts" }],
				file_paths: ["c.ts", "a.ts"],
				note: "not-a-path.ts",
			}),
		).toEqual(["a.ts", "b.ts", "c.ts"]);
		expect(readFilesInputPaths({ path: " d.ts " })).toEqual(["d.ts"]);
		expect(readFilesInputPaths("e.ts")).toEqual([]);
	});

	it("collects patch targets including move destinations", () => {
		const patch = [
			"*** Begin Patch",
			"*** Update File: src/a.ts",
			"*** Move to: src/b.ts",
			"@@",
			"-old",
			"+new",
			"*** Add File: src/c.ts",
			"*** Delete File: src/d.ts",
			"*** End Patch",
		].join("\n");
		expect(applyPatchInputPaths({ input: patch })).toEqual([
			"src/a.ts",
			"src/b.ts",
			"src/c.ts",
			"src/d.ts",
		]);
		expect(applyPatchInputPaths(patch)).toHaveLength(4);
		expect(applyPatchInputPaths({})).toEqual([]);
	});

	it("resolves relative targets against the session cwd", () => {
		expect(
			toolEnvironmentTargetPaths("edit", { path: "src/a.ts" }, "/repo"),
		).toEqual(["/repo/src/a.ts"]);
		expect(
			toolEnvironmentTargetPaths("read", { files: [{ path: "/abs" }] }, "/r"),
		).toEqual(["/abs"]);
		expect(toolEnvironmentTargetPaths("command", {}, "/repo")).toEqual([]);
	});

	it("hashes files, and records missing, oversized and non-file targets", async () => {
		const file = join(dir, "a.txt");
		writeFileSync(file, "hello\n");
		mkdirSync(join(dir, "sub"));
		expect(await hashFileFact(file)).toEqual({
			path: file,
			exists: true,
			bytes: 6,
			sha256: createHash("sha256").update("hello\n").digest("hex"),
		});
		expect(await hashFileFact(join(dir, "missing.txt"))).toEqual({
			path: join(dir, "missing.txt"),
			exists: false,
		});
		expect(await hashFileFact(file, 3)).toEqual({
			path: file,
			exists: true,
			bytes: 6,
			skipped: "too-large",
		});
		expect(await hashFileFact(join(dir, "sub"))).toEqual({
			path: join(dir, "sub"),
			exists: true,
			skipped: "not-a-file",
		});
	});

	it("derives exit facts from run_commands results", () => {
		expect(
			commandResultFacts([
				{ query: "echo ok", result: "ok\n", success: true },
				{
					query: "false",
					result: "[Command exited with code 1]",
					success: false,
					error: "Command exited with code 1",
				},
				{
					query: "sleep 99",
					success: false,
					error: "Command terminated by signal SIGTERM",
				},
				{ query: "nope", success: false, error: "spawn ENOENT" },
			]),
		).toEqual([
			{ command: "echo ok", exitCode: 0 },
			{ command: "false", exitCode: 1 },
			{ command: "sleep 99", exitCode: null, signal: "SIGTERM" },
			{ command: "nope", exitCode: null, failed: "spawn ENOENT" },
		]);
		expect(commandResultFacts("not an array")).toEqual([]);
	});

	it("records only allowlisted environment variables", () => {
		expect(
			collectRecordedEnv({
				PATH: "/bin",
				HOME: "/home/u",
				ANTHROPIC_API_KEY: "sk-secret",
				GITHUB_TOKEN: "ghp_secret",
			}),
		).toEqual({ PATH: "/bin", HOME: "/home/u" });
	});
});
