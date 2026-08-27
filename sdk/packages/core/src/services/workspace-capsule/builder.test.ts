import { createHash } from "node:crypto";
import {
	chmod,
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildWorkspaceCapsulePlan } from "./builder";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "cline-capsule-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("buildWorkspaceCapsulePlan", () => {
	it("plans only parent-selected files without requiring Git", async () => {
		const root = await temporaryDirectory();
		await mkdir(join(root, "src"));
		await writeFile(
			join(root, "src", "index.ts"),
			"export const answer = 42;\n",
		);
		await writeFile(join(root, "not-selected.txt"), "private context\n");
		await chmod(join(root, "src", "index.ts"), 0o640);
		const canonicalRoot = await realpath(root);

		const plan = await buildWorkspaceCapsulePlan({
			roots: [{ id: "workspace", path: root }],
			selections: [{ rootId: "workspace", path: "src" }],
			now: () => new Date("2026-08-26T12:00:00.000Z"),
		});

		expect(plan.manifest.git).toBeUndefined();
		expect(plan.manifest.entries.map((entry) => entry.path)).toEqual([
			"src",
			"src/index.ts",
		]);
		expect(JSON.stringify(plan.manifest)).not.toContain(root);
		expect(plan.payloads).toHaveLength(1);
		expect(plan.payloads[0]).toMatchObject({
			entryPath: "src/index.ts",
			sourcePath: join(canonicalRoot, "src", "index.ts"),
			sha256: createHash("sha256")
				.update("export const answer = 42;\n")
				.digest("hex"),
		});
	});

	it("distinguishes explicit artifacts and supports portable destinations", async () => {
		const workspace = await temporaryDirectory();
		const builds = await temporaryDirectory();
		await writeFile(join(workspace, "package.json"), "{}\n");
		await writeFile(join(builds, "Cline.dmg"), "fake dmg");

		const plan = await buildWorkspaceCapsulePlan({
			roots: [
				{ id: "workspace", path: workspace },
				{ id: "builds", path: builds },
			],
			selections: [
				{ rootId: "workspace", path: "package.json" },
				{
					rootId: "builds",
					path: "Cline.dmg",
					purpose: "artifact",
					destination: "artifacts/Cline.dmg",
				},
			],
		});

		expect(plan.manifest.entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "package.json",
					purpose: "workspace",
				}),
				expect.objectContaining({
					path: "artifacts/Cline.dmg",
					purpose: "artifact",
				}),
			]),
		);
	});

	it.each([
		".env",
		".env.local",
		".npmrc",
		"credentials.json",
		"id_rsa",
	])("blocks secret-like input %s", async (name) => {
		const root = await temporaryDirectory();
		await writeFile(join(root, name), "secret");

		await expect(
			buildWorkspaceCapsulePlan({
				roots: [{ id: "workspace", path: root }],
				selections: [{ rootId: "workspace", path: name }],
			}),
		).rejects.toMatchObject({
			code: "BLOCKED_PATH",
		});
	});

	it("skips and reports sensitive descendants of a recursive selection", async () => {
		const root = await temporaryDirectory();
		await mkdir(join(root, ".cline"));
		await writeFile(join(root, ".cline", "rules.md"), "untrusted rules");
		await writeFile(join(root, "safe.txt"), "safe");

		const plan = await buildWorkspaceCapsulePlan({
			roots: [{ id: "workspace", path: root }],
			selections: [{ rootId: "workspace", path: "." }],
		});

		expect(plan.manifest.entries.map((entry) => entry.path)).toEqual([
			"safe.txt",
		]);
		expect(plan.skippedPaths).toEqual([
			{ rootId: "workspace", path: ".cline", reason: "blocked_path" },
		]);
	});

	it("supports a repository-root selection while skipping .git and all env files", async () => {
		const root = await temporaryDirectory();
		await mkdir(join(root, ".git"));
		await writeFile(join(root, ".git", "config"), "sensitive metadata");
		await writeFile(join(root, ".env"), "TOKEN=real-secret-value-123456");
		await writeFile(join(root, ".envrc"), "export TOKEN=real-secret-value");
		await writeFile(
			join(root, ".envrc.local"),
			"export TOKEN=another-real-secret-value",
		);
		await writeFile(
			join(root, ".env.example"),
			"OPENAI_API_KEY=example-placeholder\n",
		);
		await writeFile(join(root, "package.json"), "{}\n");

		const plan = await buildWorkspaceCapsulePlan({
			roots: [{ id: "repo", path: root }],
			selections: [{ rootId: "repo", path: "." }],
		});

		expect(plan.manifest.entries.map((entry) => entry.path)).toEqual([
			"package.json",
		]);
		expect(plan.skippedPaths).toEqual([
			{ rootId: "repo", path: ".env", reason: "blocked_path" },
			{ rootId: "repo", path: ".env.example", reason: "blocked_path" },
			{ rootId: "repo", path: ".envrc", reason: "blocked_path" },
			{ rootId: "repo", path: ".envrc.local", reason: "blocked_path" },
			{ rootId: "repo", path: ".git", reason: "blocked_path" },
		]);
	});

	it.each([
		".git",
		".env",
		".env.example",
		".envrc",
		".envrc.local",
	])("still rejects directly selected blocked path %s", async (name) => {
		const root = await temporaryDirectory();
		if (name === ".git") await mkdir(join(root, name));
		else await writeFile(join(root, name), "secret");

		await expect(
			buildWorkspaceCapsulePlan({
				roots: [{ id: "workspace", path: root }],
				selections: [{ rootId: "workspace", path: name }],
			}),
		).rejects.toMatchObject({ code: "BLOCKED_PATH" });
	});

	it.each([
		["private key", "-----BEGIN PRIVATE KEY-----\nnot-real\n"],
		[
			"provider token",
			'export const token = "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";\n',
		],
		[
			"credential assignment",
			'GITHUB_TOKEN="abcdefghijklmnopqrstuvwxyz0123456789"\n',
		],
	])("blocks high-confidence %s content in workspace files", async (_label, content) => {
		const root = await temporaryDirectory();
		await writeFile(join(root, "config.ts"), content);

		await expect(
			buildWorkspaceCapsulePlan({
				roots: [{ id: "workspace", path: root }],
				selections: [{ rootId: "workspace", path: "config.ts" }],
			}),
		).rejects.toMatchObject({ code: "BLOCKED_SECRET" });
	});

	it("does not mistake placeholders for secrets or decode explicit artifacts", async () => {
		const root = await temporaryDirectory();
		await writeFile(
			join(root, "config.example.ts"),
			'OPENAI_API_KEY="replace-with-example-placeholder"\n',
		);
		await writeFile(
			join(root, "bundle.bin"),
			Buffer.from("\0-----BEGIN PRIVATE KEY-----\0", "utf8"),
		);

		const plan = await buildWorkspaceCapsulePlan({
			roots: [{ id: "workspace", path: root }],
			selections: [
				{ rootId: "workspace", path: "config.example.ts" },
				{ rootId: "workspace", path: "bundle.bin", purpose: "artifact" },
			],
		});

		expect(plan.manifest.entries).toHaveLength(2);
	});

	it("scans textual artifact contents for high-confidence secrets", async () => {
		const root = await temporaryDirectory();
		await writeFile(
			join(root, "build.log"),
			"GITHUB_TOKEN=abcdefghijklmnopqrstuvwxyz0123456789\n",
		);

		await expect(
			buildWorkspaceCapsulePlan({
				roots: [{ id: "artifacts", path: root }],
				selections: [
					{ rootId: "artifacts", path: "build.log", purpose: "artifact" },
				],
			}),
		).rejects.toMatchObject({ code: "BLOCKED_SECRET" });
	});

	it("skips and reports secret content discovered during a recursive walk", async () => {
		const root = await temporaryDirectory();
		await writeFile(join(root, "safe.txt"), "safe\n");
		await writeFile(
			join(root, "leaked-fixture.txt"),
			"-----BEGIN PRIVATE KEY-----\nnot-real\n",
		);

		const plan = await buildWorkspaceCapsulePlan({
			roots: [{ id: "workspace", path: root }],
			selections: [{ rootId: "workspace", path: "." }],
		});

		expect(plan.manifest.entries.map((entry) => entry.path)).toEqual([
			"safe.txt",
		]);
		expect(plan.skippedPaths).toEqual([
			{
				rootId: "workspace",
				path: "leaked-fixture.txt",
				reason: "blocked_secret",
			},
		]);
	});

	it("blocks traversal and symlinks that escape an approved root", async () => {
		const root = await temporaryDirectory();
		const outside = await temporaryDirectory();
		await writeFile(join(outside, "secret.txt"), "secret");

		await expect(
			buildWorkspaceCapsulePlan({
				roots: [{ id: "workspace", path: root }],
				selections: [{ rootId: "workspace", path: "../outside" }],
			}),
		).rejects.toMatchObject({ code: "PATH_OUTSIDE_APPROVED_ROOT" });

		if (process.platform !== "win32") {
			await symlink(join(outside, "secret.txt"), join(root, "escape"));
			await expect(
				buildWorkspaceCapsulePlan({
					roots: [{ id: "workspace", path: root }],
					selections: [{ rootId: "workspace", path: "escape" }],
				}),
			).rejects.toMatchObject({ code: "PATH_OUTSIDE_APPROVED_ROOT" });
		}
	});

	it("blocks contained symlinks in the v1 contract", async () => {
		if (process.platform === "win32") return;
		const root = await temporaryDirectory();
		await writeFile(join(root, "target.txt"), "target");
		await symlink("target.txt", join(root, "link.txt"));

		await expect(
			buildWorkspaceCapsulePlan({
				roots: [{ id: "workspace", path: root }],
				selections: [{ rootId: "workspace", path: "link.txt" }],
			}),
		).rejects.toMatchObject({ code: "SYMLINK_UNSUPPORTED" });
	});

	it("enforces workspace, artifact, and aggregate size limits", async () => {
		const root = await temporaryDirectory();
		await writeFile(join(root, "source.bin"), "12345");
		await writeFile(join(root, "artifact.bin"), "1234567890");

		await expect(
			buildWorkspaceCapsulePlan({
				roots: [{ id: "workspace", path: root }],
				selections: [{ rootId: "workspace", path: "source.bin" }],
				limits: { maxFileBytes: 4 },
			}),
		).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });

		await expect(
			buildWorkspaceCapsulePlan({
				roots: [{ id: "workspace", path: root }],
				selections: [
					{
						rootId: "workspace",
						path: "artifact.bin",
						purpose: "artifact",
					},
				],
				limits: { maxArtifactBytes: 9 },
			}),
		).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });

		await expect(
			buildWorkspaceCapsulePlan({
				roots: [{ id: "workspace", path: root }],
				selections: [
					{ rootId: "workspace", path: "source.bin" },
					{
						rootId: "workspace",
						path: "artifact.bin",
						purpose: "artifact",
					},
				],
				limits: { maxTotalBytes: 14 },
			}),
		).rejects.toMatchObject({ code: "TOTAL_TOO_LARGE" });
	});

	it("rejects two selected inputs mapped to one capsule destination", async () => {
		const root = await temporaryDirectory();
		await writeFile(join(root, "one.txt"), "one");
		await writeFile(join(root, "two.txt"), "two");

		await expect(
			buildWorkspaceCapsulePlan({
				roots: [{ id: "workspace", path: root }],
				selections: [
					{ rootId: "workspace", path: "one.txt", destination: "input.txt" },
					{ rootId: "workspace", path: "two.txt", destination: "input.txt" },
				],
			}),
		).rejects.toMatchObject({ code: "DESTINATION_COLLISION" });
	});

	it.each([
		".cline-capsule-manifest.json",
		"nested/.git/config",
		"config/.env.local",
		"config/.envrc.local",
	])("rejects protected capsule destination %s", async (destination) => {
		const root = await temporaryDirectory();
		await writeFile(join(root, "input.txt"), "input");

		await expect(
			buildWorkspaceCapsulePlan({
				roots: [{ id: "workspace", path: root }],
				selections: [{ rootId: "workspace", path: "input.txt", destination }],
			}),
		).rejects.toMatchObject({ code: "BLOCKED_PATH" });
	});
});
