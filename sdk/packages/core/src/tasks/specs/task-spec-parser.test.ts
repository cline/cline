import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgendaTaskSpecFileStore } from "./task-spec-file-store";
import { parseAgendaTaskSpec } from "./task-spec-parser";

const roots: string[] = [];
const WORKSPACE_ROOT = resolve("/workspace");

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("parseAgendaTaskSpec", () => {
	it("parses canonical frontmatter and derives workspace scope", () => {
		const result = parseAgendaTaskSpec({
			specPath: join(WORKSPACE_ROOT, ".cline", "tasks", "check-pr.task.md"),
			scope: "workspace",
			workspaceRoot: WORKSPACE_ROOT,
			raw: `---
taskId: task_check_pr
type: follow-up
priority: 0
title: Check PR after CI
description: Verify the required checks.
availableAt: 2035-01-01T00:00:00.000Z
expiresAt: 2035-01-02T00:00:00.000Z
resourcePaths:
  - apps/api/router.ts
modelSelection:
  providerId: anthropic
  modelId: claude
mode: act
maxIterations: 12
timeoutSeconds: 300
automationEligible: true
---

Inspect the CI checks and fix any regressions.
`,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.spec).toMatchObject({
			taskId: "task_check_pr",
			type: "follow-up",
			priority: 0,
			scope: "workspace",
			workspaceRoot: WORKSPACE_ROOT,
			resourcePaths: [join("apps", "api", "router.ts")],
			instructions: "Inspect the CI checks and fix any regressions.",
			modelSelection: { providerId: "anthropic", modelId: "claude" },
		});
		expect(result.spec.contentHash).toHaveLength(64);
	});

	it("rejects manager-owned fields and invalid priorities", () => {
		const reserved = parseAgendaTaskSpec({
			specPath: "/tmp/task.task.md",
			scope: "global",
			raw: `---
type: todo
title: Unsafe
priority: 2
expiresAt: 2035-01-02T00:00:00.000Z
status: approved
---
Do it.
`,
		});
		expect(reserved).toMatchObject({
			ok: false,
			error: expect.stringContaining("operational field"),
		});

		const badPriority = parseAgendaTaskSpec({
			specPath: "/tmp/task.task.md",
			scope: "global",
			raw: `---
type: todo
title: Invalid
priority: 6
expiresAt: 2035-01-02T00:00:00.000Z
---
Do it.
`,
		});
		expect(badPriority).toMatchObject({
			ok: false,
			error: "priority must be an integer from 0 to 5",
		});
	});

	it("rejects an availability window that ends before it begins", () => {
		const result = parseAgendaTaskSpec({
			specPath: "/tmp/task.task.md",
			scope: "global",
			raw: `---
type: reminder
title: Too late
availableAt: 2035-01-03T00:00:00.000Z
expiresAt: 2035-01-02T00:00:00.000Z
---
Remember this.
`,
		});
		expect(result).toMatchObject({
			ok: false,
			error: "availableAt must be before expiresAt",
		});
	});

	it("rejects global file references and workspace traversal", () => {
		const global = parseAgendaTaskSpec({
			specPath: "/tmp/task.task.md",
			scope: "global",
			raw: `---
type: todo
title: Unsafe global file
expiresAt: 2035-01-02T00:00:00.000Z
resourcePaths: [secrets.txt]
---
Read it.
`,
		});
		expect(global).toMatchObject({
			ok: false,
			error: "global tasks cannot reference workspace files",
		});

		const traversal = parseAgendaTaskSpec({
			specPath: join(WORKSPACE_ROOT, ".cline", "tasks", "task.task.md"),
			scope: "workspace",
			workspaceRoot: WORKSPACE_ROOT,
			raw: `---
type: todo
title: Unsafe traversal
expiresAt: 2035-01-02T00:00:00.000Z
resourcePaths: [../secrets.txt]
---
Read it.
`,
		});
		expect(traversal).toMatchObject({
			ok: false,
			error: "resourcePaths must be workspace-relative without '..'",
		});
	});
});

describe("AgendaTaskSpecFileStore", () => {
	it("atomically writes and reads a canonical task spec", () => {
		const root = mkdtempSync(join(tmpdir(), "cline-task-specs-"));
		roots.push(root);
		const store = new AgendaTaskSpecFileStore({
			scope: "workspace",
			workspaceRoot: root,
			taskSpecsDir: join(root, ".cline", "tasks"),
		});

		const written = store.writeSpec({
			taskId: "task_roundtrip",
			type: "suggestion",
			title: "Review changes",
			description: "Call out risky changes.",
			instructions: "Review the current changes and report risks.",
			priority: 1,
			resourcePaths: ["src/index.ts"],
			availableAt: "2035-01-01T00:00:00.000Z",
			expiresAt: "2035-01-04T00:00:00.000Z",
			mode: "plan",
		});

		expect(written).toMatchObject({
			taskId: "task_roundtrip",
			type: "suggestion",
			priority: 1,
			workspaceRoot: root,
			instructions: "Review the current changes and report risks.",
		});
		expect(store.listSpecs()).toHaveLength(1);
		expect(
			readdirSync(store.specsDir).every((entry) => !entry.endsWith(".tmp")),
		).toBe(true);
	});

	it("does not allow paths outside its managed directory", () => {
		const root = mkdtempSync(join(tmpdir(), "cline-task-specs-"));
		roots.push(root);
		const store = new AgendaTaskSpecFileStore({
			scope: "global",
			taskSpecsDir: join(root, "tasks"),
		});

		expect(() => store.readSpec(join(root, "outside.task.md"))).toThrow(
			"within the specs directory",
		);
	});

	it("refuses create collisions and stale conditional updates", () => {
		const root = mkdtempSync(join(tmpdir(), "cline-task-specs-"));
		roots.push(root);
		const store = new AgendaTaskSpecFileStore({
			scope: "global",
			taskSpecsDir: join(root, "tasks"),
		});
		const first = store.writeSpec(
			{
				taskId: "conditional_task",
				type: "todo",
				title: "First",
				instructions: "First version.",
				expiresAt: "2035-01-04T00:00:00.000Z",
			},
			{ createOnly: true },
		);
		expect(() =>
			store.writeSpec(
				{ ...first, title: "Collision" },
				{ specPath: first.specPath, createOnly: true },
			),
		).toThrow("already exists");
		const second = store.writeSpec(
			{ ...first, title: "Second" },
			{
				specPath: first.specPath,
				expectedContentHash: first.contentHash,
			},
		);
		expect(() =>
			store.writeSpec(
				{ ...second, title: "Stale overwrite" },
				{
					specPath: second.specPath,
					expectedContentHash: first.contentHash,
				},
			),
		).toThrow("changed before update");
		expect(store.readSpec(second.specPath)).toMatchObject({
			ok: true,
			spec: { title: "Second" },
		});
	});

	it("keeps distinct taskIds on distinct spec files after sanitizing", () => {
		const root = mkdtempSync(join(tmpdir(), "cline-task-specs-"));
		roots.push(root);
		const store = new AgendaTaskSpecFileStore({
			scope: "global",
			taskSpecsDir: join(root, "tasks"),
		});

		const sanitized = store.resolveWritePath("foo/bar");
		const literal = store.resolveWritePath("foo-bar");
		expect(sanitized).not.toBe(literal);
		expect(literal).toBe(join(store.specsDir, "foo-bar.task.md"));
		expect(store.resolveWritePath("foo/bar")).toBe(sanitized);
		expect(store.resolveWritePath("foo\\bar")).not.toBe(sanitized);
	});

	it("writes workspace cwd relative and reads it back absolute", () => {
		const root = mkdtempSync(join(tmpdir(), "cline-task-specs-"));
		roots.push(root);
		const store = new AgendaTaskSpecFileStore({
			scope: "workspace",
			workspaceRoot: root,
		});

		const written = store.writeSpec({
			taskId: "task_relative_cwd",
			type: "todo",
			title: "Stay portable",
			instructions: "Run inside the packages directory.",
			cwd: join(root, "packages", "core"),
			expiresAt: "2035-01-04T00:00:00.000Z",
		});
		expect(written.cwd).toBe(join(root, "packages", "core"));

		const raw = readFileSync(written.specPath, "utf8");
		expect(raw).toContain("cwd: packages/core");
		expect(raw).not.toContain(root);

		const atRoot = store.writeSpec({
			taskId: "task_root_cwd",
			type: "todo",
			title: "Run at the root",
			instructions: "Run at the workspace root.",
			cwd: root,
			expiresAt: "2035-01-04T00:00:00.000Z",
		});
		expect(readFileSync(atRoot.specPath, "utf8")).toContain("cwd: .");
		expect(readFileSync(atRoot.specPath, "utf8")).not.toContain(root);
	});

	it("gitignores workspace spec directories without clobbering user rules", () => {
		const root = mkdtempSync(join(tmpdir(), "cline-task-specs-"));
		roots.push(root);
		const store = new AgendaTaskSpecFileStore({
			scope: "workspace",
			workspaceRoot: root,
		});
		store.ensureSpecsDir();
		const gitignorePath = join(store.specsDir, ".gitignore");
		expect(readFileSync(gitignorePath, "utf8")).toBe("*\n");

		writeFileSync(gitignorePath, "# keep specs committed\n", "utf8");
		store.ensureSpecsDir();
		expect(readFileSync(gitignorePath, "utf8")).toBe(
			"# keep specs committed\n",
		);

		const globalStore = new AgendaTaskSpecFileStore({
			scope: "global",
			taskSpecsDir: join(root, "global-tasks"),
		});
		globalStore.ensureSpecsDir();
		expect(existsSync(join(globalStore.specsDir, ".gitignore"))).toBe(false);
	});

	it("rejects a workspace task directory that escapes through a symlink", () => {
		const root = mkdtempSync(join(tmpdir(), "cline-task-specs-"));
		const outside = mkdtempSync(join(tmpdir(), "cline-task-specs-outside-"));
		roots.push(root, outside);
		mkdirSync(join(root, ".cline"));
		symlinkSync(outside, join(root, ".cline", "tasks"), "dir");
		const store = new AgendaTaskSpecFileStore({
			scope: "workspace",
			workspaceRoot: root,
		});

		expect(() => store.ensureSpecsDir()).toThrow("symbolic link");
	});
});
