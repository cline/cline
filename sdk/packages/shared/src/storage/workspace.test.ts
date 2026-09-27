import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CLINE_BOUNDARY_FILE_NAME,
	CLINE_IGNORE_FILE_NAME,
	findWorkspaceHierarchy,
	findWorkspaceHierarchySync,
	findWorkspaceTraversalStop,
	isFileSystemRoot,
	loadClineIgnorePatternsSync,
	loadWorkspaceConfigSync,
	matchesAnyGlob,
	matchesGlob,
	resolveHierarchicalWorkspace,
	resolveHierarchicalWorkspaceSync,
	WorkspaceConfigSchema,
	type WorkspaceConfig,
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

describe("Workspace traversal boundary rules", () => {
	const config = (overrides: Partial<WorkspaceConfig> = {}): WorkspaceConfig =>
		WorkspaceConfigSchema.parse(overrides);

	it("detects POSIX and Windows filesystem roots", () => {
		expect(isFileSystemRoot("/", path.posix)).toBe(true);
		expect(isFileSystemRoot("/home/dev", path.posix)).toBe(false);
		// A drive root is its own parent under win32 path semantics, which is the
		// only way to assert the Windows stop without a Windows host.
		expect(isFileSystemRoot("C:\\", path.win32)).toBe(true);
		expect(isFileSystemRoot("C:\\Users\\dev", path.win32)).toBe(false);
	});

	it("stops on an isolation boundary declared in workspace.json", () => {
		expect(
			findWorkspaceTraversalStop({
				dir: "/repo",
				config: config({ isolated: true }),
				hasBoundaryMarker: false,
			}),
		).toBe("isolated");
	});

	it("stops on a .cline-boundary marker even when isolated is false", () => {
		expect(
			findWorkspaceTraversalStop({
				dir: "/repo",
				config: config({ isolated: false }),
				hasBoundaryMarker: true,
			}),
		).toBe("isolated");
	});

	it("ignores isolation for directories that are not workspace layers", () => {
		// No config means no `.cline`/`.clinerules`, so the isolation rule cannot
		// fire for a plain ancestor directory.
		expect(
			findWorkspaceTraversalStop({
				dir: "/repo/packages",
				hasBoundaryMarker: true,
				hasGitDir: false,
			}),
		).toBeUndefined();
	});

	it("prefers isolation over the git root stop", () => {
		expect(
			findWorkspaceTraversalStop({
				dir: "/repo",
				config: config({ isolated: true }),
				hasGitDir: true,
				hasBoundaryMarker: false,
			}),
		).toBe("isolated");
	});

	it("stops at the git root only when stopAtGitRoot is enabled", () => {
		expect(findWorkspaceTraversalStop({ dir: "/repo", hasGitDir: true })).toBe(
			"git-root",
		);
		expect(
			findWorkspaceTraversalStop({
				dir: "/repo",
				hasGitDir: true,
				stopAtGitRoot: false,
			}),
		).toBeUndefined();
	});

	it("stops at the user home directory", () => {
		expect(
			findWorkspaceTraversalStop({
				dir: "/home/dev",
				userHome: "/home/dev",
				hasGitDir: false,
			}),
		).toBe("user-home");
		expect(
			findWorkspaceTraversalStop({
				dir: "/home/dev/project",
				userHome: "/home/dev",
				hasGitDir: false,
			}),
		).toBeUndefined();
	});

	it("stops at a Windows drive root using win32 path semantics", () => {
		expect(
			findWorkspaceTraversalStop({
				dir: "C:\\",
				pathApi: path.win32,
				userHome: "C:\\Users\\dev",
				hasGitDir: false,
				hasBoundaryMarker: false,
			}),
		).toBe("filesystem-root");
	});
});


describe("Hierarchical workspace edge cases", () => {
	let testDir: string;
	// chmod-based assertions are meaningless (permissions are ignored) as root.
	const isRootUser =
		typeof process.geteuid === "function" && process.geteuid() === 0;

	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), "cline-workspace-edge-"));
	});

	afterEach(() => {
		try {
			// Restore modes that would otherwise block recursive cleanup.
			const locked = join(testDir, "apps");
			if (existsSync(locked)) {
				chmodSync(locked, 0o755);
			}
			rmSync(testDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	});

	it("resolves a symlinked start path lexically, without following the link", () => {
		mkdirSync(join(testDir, ".cline", "rules"), { recursive: true });
		mkdirSync(join(testDir, "apps", "cli"), { recursive: true });
		symlinkSync(join(testDir, "apps"), join(testDir, "link-to-apps"), "dir");

		const resolved = resolveHierarchicalWorkspaceSync(
			join(testDir, "link-to-apps", "cli"),
		);

		expect(resolved.isInitialized).toBe(true);
		expect(resolved.primaryRoot).toBe(testDir);
		// The anchor comes from the lexical path the caller passed, not the
		// realpath, so a linked working copy behaves like the directory it is in.
		expect(resolved.targetPath).toBe(join(testDir, "link-to-apps", "cli"));
		expect(resolved.layers.map((layer) => layer.path)).toEqual([testDir]);
	});

	it("collapses redundant segments and never yields duplicate layers", () => {
		mkdirSync(join(testDir, ".cline"), { recursive: true });
		const nested = join(testDir, "apps", "cli");
		mkdirSync(nested, { recursive: true });
		symlinkSync(join(testDir, "apps"), join(testDir, "alias-apps"), "dir");

		for (const startPath of [
			join(testDir, "apps", "..", "apps", "cli"),
			join(testDir, "alias-apps", "cli"),
			join(nested, "src", ".."),
			`${nested}${path.sep}`,
		]) {
			const resolved = findWorkspaceHierarchySync(startPath);
			const layerPaths = resolved.layers.map((layer) => layer.path);
			// The traversal `visited` guard: each ancestor appears at most once.
			expect(new Set(layerPaths).size).toBe(layerPaths.length);
			expect(resolved.discoveredRoots).toEqual(
				layerPaths.slice().reverse(),
			);
			expect(resolved.primaryRoot).toBe(testDir);
		}
	});

	it("terminates on a symlink loop during sub-cline discovery", () => {
		mkdirSync(join(testDir, ".cline"), { recursive: true });
		writeFileSync(
			join(testDir, ".cline", "workspace.json"),
			JSON.stringify({ includes: ["packages/**"] }),
		);
		const packageA = join(testDir, "packages", "a");
		mkdirSync(join(packageA, ".cline"), { recursive: true });
		// `packages/self` points back at its own parent: an unbounded tree that the
		// BFS visited set and depth cap must cut short.
		symlinkSync(
			join(testDir, "packages"),
			join(testDir, "packages", "self"),
			"dir",
		);

		const resolved = resolveHierarchicalWorkspaceSync(testDir);

		expect(resolved.discoveredSubClines).toContain(packageA);
		expect(resolved.discoveredSubClines.length).toBeLessThan(20);
	});

	it("deduplicates sub-clines matched by repeated includes patterns", () => {
		mkdirSync(join(testDir, ".cline"), { recursive: true });
		writeFileSync(
			join(testDir, ".cline", "workspace.json"),
			JSON.stringify({ includes: ["apps/*", "apps/**", "apps/cli"] }),
		);
		const app = join(testDir, "apps", "cli");
		mkdirSync(join(app, ".cline"), { recursive: true });

		const resolved = resolveHierarchicalWorkspaceSync(testDir);

		expect(resolved.discoveredSubClines).toEqual([app]);
	});

	it.skipIf(isRootUser)(
		"degrades gracefully when an ancestor directory is unreadable",
		() => {
			mkdirSync(join(testDir, ".cline", "rules"), { recursive: true });
			const locked = join(testDir, "apps");
			const startDir = join(locked, "cli");
			mkdirSync(startDir, { recursive: true });
			chmodSync(locked, 0o000);

			try {
				const resolved = resolveHierarchicalWorkspaceSync(startDir);
				// Probes inside the unreadable directory read as "no .cline here"
				// instead of throwing, so the workspace above it is still found.
				expect(resolved.isInitialized).toBe(true);
				expect(resolved.primaryRoot).toBe(testDir);
				expect(resolved.layers.map((layer) => layer.path)).toEqual([testDir]);
			} finally {
				chmodSync(locked, 0o755);
			}
		},
	);

	it("terminates at the filesystem root instead of ascending past home", () => {
		const missing = join(testDir, "no", "such", "workspace");
		mkdirSync(missing, { recursive: true });

		const resolved = resolveHierarchicalWorkspaceSync(missing, {
			stopAtGitRoot: false,
			// Pinning home to `/` makes the walk stop exactly at the filesystem
			// root, so the result cannot depend on the developer's real home.
			userHomeDir: path.sep,
		});

		expect(resolved.isInitialized).toBe(false);
		expect(resolved.layers).toEqual([]);
		expect(resolved.primaryRoot).toBe(missing);
		expect(resolved.targetPath).toBe(missing);
	});
});

