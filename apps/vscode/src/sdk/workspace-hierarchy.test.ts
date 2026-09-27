import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
	formatWorkspaceStatusBar,
	matchesWorkspaceHistoryScope,
	resolveWorkspaceHierarchyInfo,
	workspaceHistoryScopeLayers,
} from "./workspace-hierarchy"

const tempRoots: string[] = []

afterEach(() => {
	for (const dir of tempRoots) {
		rmSync(dir, { recursive: true, force: true })
	}
	tempRoots.length = 0
})

function createRoot(): string {
	// realpath so macOS /var → /private/var symlinks don't break path equality.
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "cline-workspace-hierarchy-")))
	tempRoots.push(dir)
	return dir
}

function makeDir(parent: string, ...segments: string[]): string {
	const dir = join(parent, ...segments)
	mkdirSync(dir, { recursive: true })
	return dir
}

function addWorkspace(dir: string, config?: Record<string, unknown>): void {
	const clineDir = join(dir, ".cline")
	mkdirSync(clineDir, { recursive: true })
	if (config) {
		writeFileSync(join(clineDir, "workspace.json"), JSON.stringify(config), "utf8")
	}
}

/** repo(.cline "monorepo", .git) / apps / cli(.cline "apps-cli") / src */
function createMonorepo(): { repo: string; cli: string; src: string } {
	const repo = createRoot()
	addWorkspace(repo, { name: "monorepo" })
	mkdirSync(join(repo, ".git"), { recursive: true })
	const cli = makeDir(repo, "apps", "cli")
	addWorkspace(cli, { name: "apps-cli" })
	const src = makeDir(cli, "src")
	return { repo, cli, src }
}

describe("resolveWorkspaceHierarchyInfo", () => {
	it("reports an uninitialized target without throwing", () => {
		const target = createRoot()
		const info = resolveWorkspaceHierarchyInfo(target)

		expect(info.isInitialized).toBe(false)
		expect(info.primaryRoot).toBe(target)
		expect(info.inheritedFrom).toBeUndefined()
		expect(info.layers).toHaveLength(1)
		expect(info.layers[0].isPrimary).toBe(true)
	})

	it("degrades to uninitialized for a path that does not exist", () => {
		const missing = join(createRoot(), "nope", "deeper")
		const info = resolveWorkspaceHierarchyInfo(missing)

		expect(info.isInitialized).toBe(false)
		expect(info.primaryRoot).toBe(missing)
	})

	it("resolves a workspace declared at the target folder itself", () => {
		const root = createRoot()
		addWorkspace(root, { name: "my-service" })

		const info = resolveWorkspaceHierarchyInfo(root)

		expect(info.isInitialized).toBe(true)
		expect(info.primaryRoot).toBe(root)
		expect(info.inheritedFrom).toBeUndefined()
		expect(info.layers.map((layer) => layer.displayName)).toEqual(["my-service"])
	})

	it("falls back to the folder basename when workspace.json has no name", () => {
		const root = createRoot()
		addWorkspace(root)

		expect(resolveWorkspaceHierarchyInfo(root).layers[0].displayName).toBe(basename(root))
	})

	it("orders monorepo layers root-most first and reports the inheritance anchor", () => {
		const { repo, cli, src } = createMonorepo()

		const info = resolveWorkspaceHierarchyInfo(src)

		expect(info.isInitialized).toBe(true)
		expect(info.primaryRoot).toBe(cli)
		expect(info.targetPath).toBe(src)
		expect(info.layers.map((layer) => layer.path)).toEqual([repo, cli])
		expect(info.layers.map((layer) => layer.isPrimary)).toEqual([false, true])
		expect(info.layers[0].isGitRoot).toBe(true)
		expect(info.inheritedFrom?.path).toBe(repo)
		expect(info.inheritedFrom?.displayName).toBe("monorepo")
		expect(workspaceHistoryScopeLayers(info)).toEqual([repo, cli])
	})

	it("stops at an isolation boundary so a sealed sub-cline inherits nothing", () => {
		const { repo, cli, src } = createMonorepo()
		writeFileSync(join(cli, ".cline-boundary"), "", "utf8")

		const info = resolveWorkspaceHierarchyInfo(src)

		expect(info.primaryRoot).toBe(cli)
		expect(info.layers.map((layer) => layer.path)).toEqual([cli])
		expect(info.inheritedFrom).toBeUndefined()
		expect(repo).toBeTruthy()
	})
})

describe("formatWorkspaceStatusBar", () => {
	it("uses the folder icon and plain name for a direct workspace", () => {
		const root = createRoot()
		addWorkspace(root, { name: "apps/cli" })

		expect(formatWorkspaceStatusBar(resolveWorkspaceHierarchyInfo(root)).text).toBe("$(folder) Cline: apps/cli")
	})

	it("uses the repo icon and inheritance suffix for an inherited workspace", () => {
		const { src } = createMonorepo()

		expect(formatWorkspaceStatusBar(resolveWorkspaceHierarchyInfo(src)).text).toBe(
			"$(repo) Cline: apps-cli (inherited from monorepo)",
		)
	})

	it("still renders a label for an uninitialized folder", () => {
		const root = createRoot()
		const content = formatWorkspaceStatusBar(resolveWorkspaceHierarchyInfo(root))

		expect(content.text).toBe(`$(folder) Cline: ${basename(root)}`)
		expect(content.tooltip).toContain("No `.cline` workspace found")
	})
})

describe("matchesWorkspaceHistoryScope", () => {
	it("matches only the primary anchor for the current scope", () => {
		const { repo, cli } = createMonorepo()
		const info = resolveWorkspaceHierarchyInfo(cli)

		expect(matchesWorkspaceHistoryScope({ anchorWorkspacePath: cli }, "current", info)).toBe(true)
		expect(matchesWorkspaceHistoryScope({ anchorWorkspacePath: repo }, "current", info)).toBe(false)
		expect(matchesWorkspaceHistoryScope({ anchorWorkspacePath: join(repo, "apps", "other") }, "current", info)).toBe(false)
	})

	it("falls back to the legacy cwd/workspaceRoot when no anchor is recorded", () => {
		const { repo, cli } = createMonorepo()
		const info = resolveWorkspaceHierarchyInfo(cli)

		expect(matchesWorkspaceHistoryScope({ cwd: cli }, "current", info)).toBe(true)
		expect(matchesWorkspaceHistoryScope({ anchorWorkspacePath: null, workspaceRoot: repo }, "current", info)).toBe(false)
	})

	it("includes the ancestor layer and nested sub-clines for the hierarchical scope", () => {
		const { repo, cli, src } = createMonorepo()
		const info = resolveWorkspaceHierarchyInfo(src)

		expect(matchesWorkspaceHistoryScope({ anchorWorkspacePath: cli }, "hierarchical", info)).toBe(true)
		expect(matchesWorkspaceHistoryScope({ anchorWorkspacePath: repo }, "hierarchical", info)).toBe(true)
		expect(matchesWorkspaceHistoryScope({ anchorWorkspacePath: join(cli, "packages", "nested") }, "hierarchical", info)).toBe(
			true,
		)
		expect(matchesWorkspaceHistoryScope({ anchorWorkspacePath: join(repo, "apps", "other") }, "hierarchical", info)).toBe(
			false,
		)
	})

	it("does not leak sessions from a sibling repository that merely shares a prefix", () => {
		const { cli } = createMonorepo()
		const info = resolveWorkspaceHierarchyInfo(cli)

		expect(matchesWorkspaceHistoryScope({ anchorWorkspacePath: `${cli}-legacy` }, "hierarchical", info)).toBe(false)
	})

	it("matches every session for the all scope and rejects anchorless records otherwise", () => {
		const { cli } = createMonorepo()
		const info = resolveWorkspaceHierarchyInfo(cli)

		expect(matchesWorkspaceHistoryScope({}, "all", info)).toBe(true)
		expect(matchesWorkspaceHistoryScope({ anchorWorkspacePath: "  " }, "all", info)).toBe(true)
		expect(matchesWorkspaceHistoryScope({}, "current", info)).toBe(false)
		expect(matchesWorkspaceHistoryScope({}, "hierarchical", info)).toBe(false)
	})

	it("scopes an uninitialized workspace to its own folder subtree", () => {
		const root = createRoot()
		const nested = makeDir(root, "packages", "deep")
		const info = resolveWorkspaceHierarchyInfo(root)

		expect(matchesWorkspaceHistoryScope({ anchorWorkspacePath: root }, "current", info)).toBe(true)
		expect(matchesWorkspaceHistoryScope({ anchorWorkspacePath: nested }, "current", info)).toBe(false)
		expect(matchesWorkspaceHistoryScope({ anchorWorkspacePath: nested }, "hierarchical", info)).toBe(true)
	})
})
