import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packages, prepareRelease, shouldPublish } from "./sdk-release.mjs";

const roots = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "sdk-release-"));
	roots.push(root);
	for (const name of packages) {
		const dir = join(root, "sdk/packages", name);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				name: `@cline/${name}`,
				version: "0.0.89",
				dependencies: { example: "1.0.0" },
			}),
		);
	}
	writeFileSync(
		join(root, "sdk/CHANGELOG.md"),
		"# Cline SDK Changelog\n\n## 0.0.89\n\n- Previous notes\n",
	);
	const git = (...args) =>
		execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	git("init", "--quiet");
	git("config", "user.name", "SDK Release Test");
	git("config", "user.email", "sdk-release@example.com");
	git("add", ".");
	git(
		"-c",
		"core.hooksPath=/dev/null",
		"commit",
		"--quiet",
		"-m",
		"Previous release",
	);
	const before = git("rev-parse", "HEAD");
	return { root, before, git };
}

test("prepares one aligned patch release and publishes it only after its version changes", () => {
	const { root, before } = fixture();
	expect(shouldPublish(root, before)).toBe(false);
	expect(prepareRelease(root, undefined, "- New SDK behavior")).toBe("0.0.90");
	expect(shouldPublish(root, before)).toBe(true);
	for (const name of packages) {
		const pkg = JSON.parse(
			readFileSync(join(root, `sdk/packages/${name}/package.json`), "utf8"),
		);
		expect(pkg.version).toBe("0.0.90");
		expect(pkg.dependencies).toEqual({ example: "1.0.0" });
	}
	expect(readFileSync(join(root, "sdk/CHANGELOG.md"), "utf8")).toContain(
		"## 0.0.90\n\n- New SDK behavior\n\n## 0.0.89",
	);
});

test("drafts notes only from SDK commits after the release tag", () => {
	const { root, git } = fixture();
	git("tag", "sdk/sdk/v0.0.89");
	writeFileSync(join(root, "sdk/change.txt"), "sdk change");
	git("add", ".");
	git(
		"-c",
		"core.hooksPath=/dev/null",
		"commit",
		"--quiet",
		"-m",
		"fix(sdk): new behavior",
	);
	writeFileSync(join(root, "other.txt"), "unrelated");
	git("add", ".");
	git(
		"-c",
		"core.hooksPath=/dev/null",
		"commit",
		"--quiet",
		"-m",
		"Unrelated change",
	);
	expect(prepareRelease(root, "0.1.0")).toBe("0.1.0");
	const notes = readFileSync(join(root, "sdk/CHANGELOG.md"), "utf8");
	expect(notes).toContain("- fix(sdk): new behavior");
	expect(notes).not.toContain("Unrelated change");
});

test("ordinary manifest dependency edits do not publish", () => {
	const { root, before } = fixture();
	const path = join(root, "sdk/packages/core/package.json");
	const pkg = JSON.parse(readFileSync(path, "utf8"));
	pkg.dependencies.example = "2.0.0";
	writeFileSync(path, JSON.stringify(pkg));
	expect(shouldPublish(root, before)).toBe(false);
});

test("rejects partial version bumps and missing release notes before publishing", () => {
	const { root, before } = fixture();
	const path = join(root, "sdk/packages/core/package.json");
	const pkg = JSON.parse(readFileSync(path, "utf8"));
	pkg.version = "0.0.90";
	writeFileSync(path, JSON.stringify(pkg));
	expect(() => shouldPublish(root, before)).toThrow("must match");
	for (const name of packages) {
		const path = join(root, `sdk/packages/${name}/package.json`);
		const pkg = JSON.parse(readFileSync(path, "utf8"));
		pkg.version = "0.0.90";
		writeFileSync(path, JSON.stringify(pkg));
	}
	expect(() => shouldPublish(root, before)).toThrow(
		"first SDK changelog entry",
	);
});

test("rejects reused, decreasing, prerelease and malformed versions without modifying files", () => {
	const { root } = fixture();
	for (const version of [
		"0.0.89",
		"0.0.88",
		"0.0.90-nightly.1",
		"01.0.0",
		"$(false)",
	]) {
		expect(() => prepareRelease(root, version, "- Notes")).toThrow();
	}
	expect(
		JSON.parse(
			readFileSync(join(root, "sdk/packages/sdk/package.json"), "utf8"),
		).version,
	).toBe("0.0.89");
});

test("requires explicit notes if the release tag is missing", () => {
	const { root } = fixture();
	expect(() => prepareRelease(root)).toThrow();
	expect(prepareRelease(root, undefined, "- Reviewed notes")).toBe("0.0.90");
});
