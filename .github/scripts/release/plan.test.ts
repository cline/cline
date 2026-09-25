import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	nextVersion,
	parsePlan,
	planPath,
	prepare,
	products,
	releaseTags,
	run,
	validate,
} from "./plan";
import { versionExists } from "./publish-sdk";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function write(root: string, path: string, value: unknown) {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(
		join(root, path),
		typeof value === "string" ? value : JSON.stringify(value),
	);
}
function read(root: string, path: string) {
	return JSON.parse(readFileSync(join(root, path), "utf8"));
}
function commit(root: string, message: string) {
	run(["git", "add", "."], root);
	run(["git", "-c", "core.hooksPath=/dev/null", "commit", "-m", message], root);
	const sha = run(["git", "rev-parse", "HEAD"], root);
	run(["git", "update-ref", "refs/remotes/origin/main", sha], root);
	return sha;
}
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "release-plan-test-"));
	roots.push(root);
	run(["git", "init", "--initial-branch=main", root]);
	run(["git", "config", "user.name", "Release test"], root);
	run(["git", "config", "user.email", "release@example.invalid"], root);
	run(["git", "config", "commit.gpgsign", "false"], root);
	for (const name of ["shared", "llms", "agents", "core", "sdk"])
		write(root, `sdk/packages/${name}/package.json`, {
			name: `@cline/${name}`,
			version: "0.8.5",
		});
	write(root, "sdk/packages/ui/package.json", {
		name: "@cline/ui",
		version: "0.2.0-next.10",
		internal: true,
	});
	write(root, products.cli.manifest, {
		version: "3.0.50",
		dependencies: { "@cline/core": "workspace:*" },
	});
	write(root, products.desktop.manifest, { version: "0.0.32" });
	write(root, "apps/examples/desktop-app/src-tauri/tauri.conf.json", {
		version: "0.0.32",
	});
	for (const product of Object.values(products))
		write(
			root,
			product.changelog,
			"# Changelog\n\n## 0.0.1\n\n- Older release\n",
		);
	write(root, ".github/.gitkeep", "");
	commit(root, "Initial versions");
	return root;
}
const bumps = { sdk: "major", cli: "minor", desktop: "patch" } as const;

describe("version increments", () => {
	test.each([
		["1.2.3", "patch", "1.2.4"],
		["1.2.3", "minor", "1.3.0"],
		["1.2.3", "major", "2.0.0"],
		["0.0.32", "major", "1.0.0"],
	])("%s %s → %s", (from, bump, expected) =>
		expect(nextVersion(from, bump)).toBe(expected));
	test.each([
		"1.2.3-beta.1",
		"01.2.3",
		"v1.2.3",
		"1.2",
		"1.2.3\n",
	])("rejects invalid stable version %s", (version) =>
		expect(() => nextVersion(version, "patch")).toThrow());
	test("rejects unknown bump", () =>
		expect(() => nextVersion("1.2.3", "latest")).toThrow());
});

test("prepares independent versions, keeps internal packages and workspace dependencies, and validates merged files", () => {
	const root = fixture();
	const plan = prepare(root, bumps);
	expect(plan.products.sdk.to).toBe("1.0.0");
	expect(plan.products.cli.to).toBe("3.1.0");
	expect(plan.products.desktop.to).toBe("0.0.33");
	expect(read(root, "sdk/packages/core/package.json").version).toBe("1.0.0");
	expect(read(root, "sdk/packages/ui/package.json").version).toBe(
		"0.2.0-next.10",
	);
	expect(read(root, products.cli.manifest).dependencies["@cline/core"]).toBe(
		"workspace:*",
	);
	expect(
		read(root, "apps/examples/desktop-app/src-tauri/tauri.conf.json").version,
	).toBe("0.0.33");
	const sha = commit(root, "Release");
	expect(validate(root, sha)).toEqual(plan);
	// Tags are not created during preparation. Existing tags on the release commit allow retry.
	expect(run(["git", "tag", "--list"], root)).toBe("");
	for (const tag of releaseTags(plan)) run(["git", "tag", tag], root);
	expect(validate(root, sha)).toEqual(plan);
});

test("draft notes start at the current release tag and include inherited SDK changes", () => {
	const root = fixture();
	for (const name of ["sdk", "cli", "desktop"] as const)
		run(
			[
				"git",
				"tag",
				`${products[name].tag}${read(root, products[name].manifest).version}`,
			],
			root,
		);
	write(root, "sdk/packages/core/change.ts", "// feature");
	commit(root, "Add provider support");
	prepare(root, bumps);
	for (const product of Object.values(products)) {
		const notes = readFileSync(join(root, product.changelog), "utf8");
		expect(notes).toContain("Add provider support");
		expect(notes).not.toContain("Initial versions");
	}
});

test("refuses a planned version whose tag already exists", () => {
	const root = fixture();
	run(["git", "tag", "cli-v3.1.0"], root);
	expect(() => prepare(root, bumps)).toThrow("already exists");
	expect(read(root, products.sdk.manifest).version).toBe("0.8.5");
});

test("validates a merge commit after another non-release commit lands on main", () => {
	const root = fixture();
	run(["git", "switch", "-c", "release"], root);
	prepare(root, bumps);
	commit(root, "Release");
	run(["git", "switch", "main"], root);
	write(root, "unrelated.txt", "Unrelated change");
	commit(root, "Other work");
	run(
		[
			"git",
			"-c",
			"core.hooksPath=/dev/null",
			"merge",
			"--no-ff",
			"release",
			"-m",
			"Merge release",
		],
		root,
	);
	const sha = run(["git", "rev-parse", "HEAD"], root);
	run(["git", "update-ref", "refs/remotes/origin/main", sha], root);
	expect(validate(root, sha).products.cli.to).toBe("3.1.0");
});

test("rejects a stale PR when main already bumped a product", () => {
	const root = fixture();
	prepare(root, bumps);
	const planned = read(root, planPath);
	run(["git", "reset", "--hard", "HEAD"], root);
	write(root, products.cli.manifest, { version: "3.0.51" });
	commit(root, "Another CLI release");
	prepare(root, bumps);
	write(root, planPath, planned);
	const sha = commit(root, "Stale release");
	expect(() => validate(root, sha)).toThrow("stale");
});

test.each([
	"sdk",
	"cli",
	"desktop",
] as const)("rejects mismatched %s release notes", (name) => {
	const root = fixture();
	prepare(root, bumps);
	write(root, products[name].changelog, "## 9.9.9\n\n- Wrong version\n");
	const sha = commit(root, "Release");
	expect(() => validate(root, sha)).toThrow("needs release notes");
});

test("rejects empty release notes", () => {
	const root = fixture();
	prepare(root, bumps);
	write(root, products.cli.changelog, "## 3.1.0\n\n## 3.0.50\n\n- Old notes\n");
	expect(() => validate(root, commit(root, "Release"))).toThrow(
		"needs release notes",
	);
});

test("rejects mismatched SDK and Tauri manifests", () => {
	const root = fixture();
	prepare(root, bumps);
	write(root, "sdk/packages/core/package.json", { version: "2.0.0" });
	expect(() => validate(root, commit(root, "Release"))).toThrow(
		"SDK version mismatch",
	);
});

test("rejects wrong checkout and conflicting tags without moving them", () => {
	const root = fixture();
	const old = run(["git", "rev-parse", "HEAD"], root);
	const plan = prepare(root, bumps);
	const sha = commit(root, "Release");
	expect(() => validate(root, old)).toThrow("Checkout must match");
	run(["git", "tag", releaseTags(plan)[0], old], root);
	expect(() => validate(root, sha)).toThrow("points at another commit");
	expect(run(["git", "rev-parse", releaseTags(plan)[0]], root)).toBe(old);
});

test("rejects malformed release plans", () => {
	expect(() => parsePlan(null)).toThrow();
	expect(() => parsePlan({ schema: 2 })).toThrow();
});

describe("SDK retry registry checks", () => {
	const response =
		(status: number, body: unknown = {}) =>
		async () =>
			new Response(JSON.stringify(body), { status });
	test("only a missing version permits a new publish", async () => {
		expect(await versionExists("@cline/core", "1.0.0", response(404))).toBe(
			false,
		);
		expect(
			await versionExists(
				"@cline/core",
				"1.0.0",
				response(200, { name: "@cline/core", version: "1.0.0" }),
			),
		).toBe(true);
	});
	test.each([
		401, 403, 429, 500,
	])("fails on registry status %s", async (status) => {
		await expect(
			versionExists("@cline/core", "1.0.0", response(status)),
		).rejects.toThrow("Registry lookup failed");
	});
	test("rejects unexpected registry content", async () => {
		await expect(
			versionExists(
				"@cline/core",
				"1.0.0",
				response(200, { version: "2.0.0" }),
			),
		).rejects.toThrow("Unexpected registry response");
	});
});

test("tag command atomically pushes every tag and can be retried against a local remote", () => {
	const root = fixture();
	const remote = mkdtempSync(join(tmpdir(), "release-remote-test-"));
	roots.push(remote);
	run(["git", "init", "--bare", remote]);
	run(["git", "remote", "add", "origin", remote], root);
	const plan = prepare(root, bumps);
	const sha = commit(root, "Release");
	run(["git", "push", "origin", "main"], root);
	const outputFile = join(root, "outputs.txt");
	const execute = () => {
		const result = Bun.spawnSync(
			[process.execPath, join(import.meta.dir, "plan.ts"), "tag"],
			{
				cwd: root,
				env: { ...process.env, RELEASE_SHA: sha, GITHUB_OUTPUT: outputFile },
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		expect(result.stderr.toString()).toBe("");
		expect(result.exitCode).toBe(0);
	};
	execute();
	execute();
	for (const tag of releaseTags(plan))
		expect(run(["git", "rev-parse", `${tag}^{commit}`], remote)).toBe(sha);
	expect(readFileSync(outputFile, "utf8")).toContain(`sha=${sha}`);
	expect(readFileSync(outputFile, "utf8")).toContain(
		"desktop_tag=desktop-v0.0.33",
	);
});

test("rejects a mismatched Tauri version", () => {
	const root = fixture();
	prepare(root, bumps);
	write(root, "apps/examples/desktop-app/src-tauri/tauri.conf.json", {
		version: "0.0.34",
	});
	expect(() => validate(root, commit(root, "Release"))).toThrow(
		"Tauri version mismatch",
	);
});

test("validates an unmerged PR without requiring its synthetic merge to be on main", () => {
	const root = fixture();
	const base = run(["git", "rev-parse", "HEAD"], root);
	prepare(root, bumps);
	const sha = commit(root, "PR merge preview");
	run(["git", "update-ref", "refs/remotes/origin/main", base], root);
	expect(validate(root, sha, "pull-request").products.cli.to).toBe("3.1.0");
	expect(() => validate(root, sha)).toThrow();
});

test.each([
	false,
	true,
])("local dry run preserves source files and refs (skipLockfile=%s)", async (skipLockfile) => {
	const { dryRun } = await import("./dry-run");
	const root = fixture();
	write(root, "package.json", {
		name: "release-fixture",
		private: true,
		workspaces: ["sdk/packages/*", "apps/cli", "apps/examples/desktop-app"],
	});
	for (const [name, product] of Object.entries(products)) {
		if (name !== "sdk")
			write(root, product.manifest, {
				...read(root, product.manifest),
				name: `@fixture/${name}`,
			});
	}
	run(
		[process.execPath, "install", "--lockfile-only", "--ignore-scripts"],
		root,
	);
	commit(root, "Workspace setup");
	// Include both tracked edits and new files in the isolated input snapshot.
	write(root, products.cli.changelog, "# Local draft\n");
	write(root, "local-input.txt", "Uncommitted input");
	const before = run(["git", "status", "--porcelain"], root);
	const refs = run(["git", "show-ref"], root);
	const lock = readFileSync(join(root, "bun.lock"), "utf8");
	const result = dryRun(root, bumps, { skipLockfile });
	roots.push(result.directory);
	expect(result.report.lockfile).toBe(skipLockfile ? "skipped" : "resolved");
	expect(result.report.plannedTags).toHaveLength(7);
	expect(readFileSync(join(result.checkout, "local-input.txt"), "utf8")).toBe(
		"Uncommitted input",
	);
	expect(
		readFileSync(join(result.directory, "release.patch"), "utf8"),
	).toContain("release-plan.json");
	expect(read(result.checkout, products.cli.manifest).version).toBe("3.1.0");
	expect(run(["git", "remote"], result.checkout)).toBe("");
	expect(run(["git", "tag"], result.checkout)).toBe("");
	expect(run(["git", "status", "--porcelain"], root)).toBe(before);
	expect(run(["git", "show-ref"], root)).toBe(refs);
	expect(readFileSync(join(root, "bun.lock"), "utf8")).toBe(lock);
});
