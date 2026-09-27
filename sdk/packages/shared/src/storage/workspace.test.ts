import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CLINE_BOUNDARY_FILE_NAME,
	CLINE_IGNORE_FILE_NAME,
	findWorkspaceHierarchy,
	findWorkspaceHierarchySync,
	loadClineIgnorePatternsSync,
	loadWorkspaceConfigSync,
	matchesAnyGlob,
	matchesGlob,
	resolveHierarchicalWorkspace,
	resolveHierarchicalWorkspaceSync,
	WorkspaceConfigSchema,
} from "./workspace";

describe("WorkspaceConfigSchema", () => {
	it("provides correct defaults when parsing an empty object", () => {
		const parsed = WorkspaceConfigSchema.parse({});
		expect(parsed.includes).toEqual([]);
		expect(parsed.ignores).toEqual([]);
		expect(parsed.isolated).toBe(false);
		expect(parsed.inheritMcpServers).toBe(true);
		expect(parsed.name).toBeUndefined();
		expect(parsed.metadata).toBeUndefined();
	});

	it("parses valid custom configurations", () => {
		const parsed = WorkspaceConfigSchema.parse({
			name: "my-monorepo",
			includes: ["apps/*", "packages/**"],
			ignores: ["apps/legacy/**", "temp-*"],
			isolated: true,
			inheritMcpServers: false,
			metadata: { team: "core", tier: 1 },
		});

		expect(parsed.name).toBe("my-monorepo");
		expect(parsed.includes).toEqual(["apps/*", "packages/**"]);
		expect(parsed.ignores).toEqual(["apps/legacy/**", "temp-*"]);
		expect(parsed.isolated).toBe(true);
		expect(parsed.inheritMcpServers).toBe(false);
		expect(parsed.metadata).toEqual({ team: "core", tier: 1 });
	});

	it("rejects invalid types", () => {
		const result = WorkspaceConfigSchema.safeParse({
			isolated: "not-a-boolean",
		});
		expect(result.success).toBe(false);
	});
});

describe("Glob matching", () => {
	it("matches exact paths", () => {
		expect(matchesGlob("apps/cli", "apps/cli")).toBe(true);
		expect(matchesGlob("apps/cli", "apps/vscode")).toBe(false);
	});

	it("matches single-level wildcards (*)", () => {
		expect(matchesGlob("apps/*", "apps/cli")).toBe(true);
		expect(matchesGlob("apps/*", "apps/vscode")).toBe(true);
		expect(matchesGlob("apps/*", "apps/cli/src")).toBe(false);
		expect(matchesGlob("packages/core-*", "packages/core-engine")).toBe(true);
		expect(matchesGlob("packages/core-*", "packages/other")).toBe(false);
	});

	it("matches multi-level wildcards (**)", () => {
		expect(matchesGlob("apps/**", "apps/cli")).toBe(true);
		expect(matchesGlob("apps/**", "apps/cli/src/index.ts")).toBe(true);
		expect(matchesGlob("packages/**", "packages/a/b/c")).toBe(true);
		expect(matchesGlob("packages/**", "apps/cli")).toBe(false);
	});

	it("matches directory trailing wildcard (dir/**)", () => {
		expect(matchesGlob("apps/legacy/**", "apps/legacy")).toBe(true);
		expect(matchesGlob("apps/legacy/**", "apps/legacy/foo")).toBe(true);
		expect(matchesGlob("apps/legacy/**", "apps/legacy/foo/bar")).toBe(true);
	});

	it("matches basename patterns across any depth without slash", () => {
		expect(matchesGlob("temp-*", "temp-experiment")).toBe(true);
		expect(matchesGlob("temp-*", "apps/temp-experiment")).toBe(true);
		expect(matchesGlob("*.log", "error.log")).toBe(true);
		expect(matchesGlob("*.log", "logs/debug.log")).toBe(true);
		expect(matchesGlob("*.log", "logs/debug.txt")).toBe(false);
	});

	it("matchesAnyGlob correctly matches if any pattern matches", () => {
		const patterns = ["apps/*", "*.test.ts", "temp-*"];
		expect(matchesAnyGlob(patterns, "apps/cli")).toBe(true);
		expect(matchesAnyGlob(patterns, "src/foo.test.ts")).toBe(true);
		expect(matchesAnyGlob(patterns, "sub/temp-scratch")).toBe(true);
		expect(matchesAnyGlob(patterns, "src/index.ts")).toBe(false);
	});
});

describe("Hierarchical Workspace Resolution", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), "cline-workspace-test-"));
	});

	afterEach(() => {
		try {
			rmSync(testDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	});

	it("loads default workspace.json when file does not exist", () => {
		const config = loadWorkspaceConfigSync(testDir);
		expect(config.isolated).toBe(false);
		expect(config.includes).toEqual([]);
	});

	it("loads and validates workspace.json when present", () => {
		const clineDir = join(testDir, ".cline");
		mkdirSync(clineDir, { recursive: true });
		writeFileSync(
			join(clineDir, "workspace.json"),
			JSON.stringify({
				name: "my-test-workspace",
				includes: ["packages/*"],
				isolated: true,
			}),
		);

		const config = loadWorkspaceConfigSync(testDir);
		expect(config.name).toBe("my-test-workspace");
		expect(config.includes).toEqual(["packages/*"]);
		expect(config.isolated).toBe(true);
	});

	it("loads ignore patterns from .clineignore and ignores comments/blank lines", () => {
		writeFileSync(
			join(testDir, CLINE_IGNORE_FILE_NAME),
			"# Ignore comment\n\ntemp-*\npackages/legacy/**\n\n# Another comment\n",
		);

		const patterns = loadClineIgnorePatternsSync(testDir);
		expect(patterns).toEqual(["temp-*", "packages/legacy/**"]);
	});

	it("resolves single-root workspace correctly", () => {
		const clineDir = join(testDir, ".cline");
		mkdirSync(clineDir, { recursive: true });
		mkdirSync(join(clineDir, "rules"), { recursive: true });

		const resolved = resolveHierarchicalWorkspaceSync(testDir);
		expect(resolved.isInitialized).toBe(true);
		expect(resolved.primaryRoot).toBe(testDir);
		expect(resolved.layers.length).toBe(1);
		expect(resolved.layers[0].path).toBe(testDir);
		expect(resolved.layers[0].hasRules).toBe(true);
		expect(resolved.layers[0].hasSkills).toBe(false);
	});

	it("resolves nested monorepo with nearest-root-first ordering", () => {
		// Mock monorepo root
		const repoRoot = testDir;
		mkdirSync(join(repoRoot, ".git"), { recursive: true });
		mkdirSync(join(repoRoot, ".cline", "rules"), { recursive: true });
		writeFileSync(
			join(repoRoot, ".cline", "workspace.json"),
			JSON.stringify({ name: "monorepo-root", includes: ["apps/*"] }),
		);

		// Mock subproject
		const appDir = join(repoRoot, "apps", "cli");
		mkdirSync(join(appDir, ".cline", "skills"), { recursive: true });
		writeFileSync(
			join(appDir, ".cline", "workspace.json"),
			JSON.stringify({ name: "cli-subproject" }),
		);

		const srcDir = join(appDir, "src", "nested");
		mkdirSync(srcDir, { recursive: true });

		// Start resolution inside subproject deep directory
		const resolved = resolveHierarchicalWorkspaceSync(srcDir);

		expect(resolved.isInitialized).toBe(true);
		// Primary root must be the nearest .cline (apps/cli)
		expect(resolved.primaryRoot).toBe(appDir);
		expect(resolved.targetPath).toBe(srcDir);

		// Layers must be ordered from root-most ancestor to primaryRoot
		expect(resolved.layers.length).toBe(2);
		expect(resolved.layers[0].path).toBe(repoRoot);
		expect(resolved.layers[0].config.name).toBe("monorepo-root");
		expect(resolved.layers[0].hasRules).toBe(true);
		expect(resolved.layers[0].isGitRoot).toBe(true);

		expect(resolved.layers[1].path).toBe(appDir);
		expect(resolved.layers[1].config.name).toBe("cli-subproject");
		expect(resolved.layers[1].hasSkills).toBe(true);
		expect(resolved.layers[1].isGitRoot).toBe(false);
	});

	it("inherits parent workspace when subfolder has no .cline", () => {
		const repoRoot = testDir;
		mkdirSync(join(repoRoot, ".git"), { recursive: true });
		mkdirSync(join(repoRoot, ".cline", "rules"), { recursive: true });

		const appDir = join(repoRoot, "apps", "cli", "src");
		mkdirSync(appDir, { recursive: true });

		const resolved = resolveHierarchicalWorkspaceSync(appDir);
		expect(resolved.isInitialized).toBe(true);
		expect(resolved.primaryRoot).toBe(repoRoot);
		expect(resolved.targetPath).toBe(appDir);
		expect(resolved.layers.length).toBe(1);
		expect(resolved.layers[0].path).toBe(repoRoot);
	});

	it("identifies uninitialized workspace when no .cline is found", () => {
		const repoRoot = testDir;
		mkdirSync(join(repoRoot, ".git"), { recursive: true });
		const subDir = join(repoRoot, "src", "code");
		mkdirSync(subDir, { recursive: true });

		const resolved = resolveHierarchicalWorkspaceSync(subDir);
		expect(resolved.isInitialized).toBe(false);
		expect(resolved.primaryRoot).toBe(subDir);
		expect(resolved.targetPath).toBe(subDir);
		expect(resolved.layers).toEqual([]);
		expect(resolved.discoveredSubClines).toEqual([]);
	});

	it("enforces isolation boundary when workspace has isolated: true", () => {
		const repoRoot = testDir;
		mkdirSync(join(repoRoot, ".git"), { recursive: true });
		mkdirSync(join(repoRoot, ".cline", "rules"), { recursive: true });

		const isolatedAppDir = join(repoRoot, "apps", "isolated-app");
		mkdirSync(join(isolatedAppDir, ".cline"), { recursive: true });
		writeFileSync(
			join(isolatedAppDir, ".cline", "workspace.json"),
			JSON.stringify({ name: "isolated-app", isolated: true }),
		);

		const resolved = resolveHierarchicalWorkspaceSync(isolatedAppDir);
		expect(resolved.isInitialized).toBe(true);
		expect(resolved.primaryRoot).toBe(isolatedAppDir);
		// Since it is isolated, it must NOT inherit the ancestor repoRoot layer
		expect(resolved.layers.length).toBe(1);
		expect(resolved.layers[0].path).toBe(isolatedAppDir);
	});

	it("enforces isolation boundary via .cline-boundary marker file", () => {
		const repoRoot = testDir;
		mkdirSync(join(repoRoot, ".git"), { recursive: true });
		mkdirSync(join(repoRoot, ".cline", "rules"), { recursive: true });

		const boundedAppDir = join(repoRoot, "apps", "bounded-app");
		mkdirSync(join(boundedAppDir, ".cline"), { recursive: true });
		writeFileSync(join(boundedAppDir, CLINE_BOUNDARY_FILE_NAME), "");

		const resolved = resolveHierarchicalWorkspaceSync(boundedAppDir);
		expect(resolved.isInitialized).toBe(true);
		expect(resolved.primaryRoot).toBe(boundedAppDir);
		expect(resolved.layers.length).toBe(1);
		expect(resolved.layers[0].path).toBe(boundedAppDir);
	});

	it("stops traversal at Git root when stopAtGitRoot is true", () => {
		// External parent with .cline
		mkdirSync(join(testDir, ".cline"), { recursive: true });

		// Git repo inside testDir
		const repoRoot = join(testDir, "nested-repo");
		mkdirSync(join(repoRoot, ".git"), { recursive: true });
		const subDir = join(repoRoot, "packages", "a");
		mkdirSync(subDir, { recursive: true });

		const resolved = resolveHierarchicalWorkspaceSync(subDir, {
			stopAtGitRoot: true,
		});
		// Should stop at Git root and not find testDir/.cline
		expect(resolved.isInitialized).toBe(false);
		expect(resolved.layers.length).toBe(0);
	});

	it("discovers declared sub-clines matching includes pattern", () => {
		const repoRoot = testDir;
		mkdirSync(join(repoRoot, ".git"), { recursive: true });
		mkdirSync(join(repoRoot, ".cline"), { recursive: true });

		// Subproject 1 (included and has .cline)
		const app1 = join(repoRoot, "apps", "frontend");
		mkdirSync(join(app1, ".cline"), { recursive: true });

		// Subproject 2 (included and has .cline)
		const app2 = join(repoRoot, "apps", "backend");
		mkdirSync(join(app2, ".cline"), { recursive: true });

		// Subproject 3 (matching glob but ignored in workspace.json)
		const app3 = join(repoRoot, "apps", "legacy");
		mkdirSync(join(app3, ".cline"), { recursive: true });

		// Subproject 4 (not matching includes)
		const tool = join(repoRoot, "tools", "builder");
		mkdirSync(join(tool, ".cline"), { recursive: true });

		writeFileSync(
			join(repoRoot, ".cline", "workspace.json"),
			JSON.stringify({
				includes: ["apps/*"],
				ignores: ["apps/legacy/**"],
			}),
		);

		const resolved = resolveHierarchicalWorkspaceSync(repoRoot);
		expect(resolved.discoveredSubClines).toContain(app1);
		expect(resolved.discoveredSubClines).toContain(app2);
		expect(resolved.discoveredSubClines).not.toContain(app3);
		expect(resolved.discoveredSubClines).not.toContain(tool);
	});

	it("handles file path as startPath cleanly", () => {
		const clineDir = join(testDir, ".cline");
		mkdirSync(clineDir, { recursive: true });
		const dummyFile = join(testDir, "README.md");
		writeFileSync(dummyFile, "# Test");

		const resolved = resolveHierarchicalWorkspaceSync(dummyFile);
		expect(resolved.isInitialized).toBe(true);
		expect(resolved.primaryRoot).toBe(testDir);
		expect(resolved.targetPath).toBe(testDir);
	});

	it("asynchronous APIs return identical results to sync APIs", async () => {
		const clineDir = join(testDir, ".cline");
		mkdirSync(clineDir, { recursive: true });

		const syncResult = resolveHierarchicalWorkspaceSync(testDir);
		const asyncResult = await resolveHierarchicalWorkspace(testDir);
		expect(asyncResult).toEqual(syncResult);

		const syncHierarchy = findWorkspaceHierarchySync(testDir);
		const asyncHierarchy = await findWorkspaceHierarchy(testDir);
		expect(asyncHierarchy).toEqual(syncHierarchy);
	});
});
