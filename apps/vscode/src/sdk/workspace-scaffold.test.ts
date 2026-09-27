import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { resolveWorkspaceHierarchyInfo } from "./workspace-hierarchy"
import { DEFAULT_PROJECT_RULES, initializeWorkspaceLayout } from "./workspace-scaffold"

const tempRoots: string[] = []

afterEach(() => {
	for (const dir of tempRoots) {
		rmSync(dir, { recursive: true, force: true })
	}
	tempRoots.length = 0
})

function createRoot(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "cline-workspace-scaffold-")))
	tempRoots.push(dir)
	return dir
}

describe("initializeWorkspaceLayout", () => {
	it("creates workspace.json, project rules, and the skills directory", () => {
		const root = createRoot()

		const result = initializeWorkspaceLayout({ targetDir: root })

		expect(result.clineDir).toBe(join(root, ".cline"))
		expect(existsSync(result.workspaceJsonPath)).toBe(true)
		expect(existsSync(result.rulesPath)).toBe(true)
		expect(existsSync(result.skillsDir)).toBe(true)
		expect(JSON.parse(readFileSync(result.workspaceJsonPath, "utf8"))).toEqual({ name: basename(root) })
		expect(readFileSync(result.rulesPath, "utf8")).toBe(DEFAULT_PROJECT_RULES)
	})

	it("uses an explicit workspace name when provided", () => {
		const root = createRoot()

		const result = initializeWorkspaceLayout({ targetDir: root, name: "  my-monorepo  " })

		expect(JSON.parse(readFileSync(result.workspaceJsonPath, "utf8"))).toEqual({ name: "my-monorepo" })
	})

	it("never clobbers existing user files", () => {
		const root = createRoot()
		const first = initializeWorkspaceLayout({ targetDir: root, name: "original" })
		writeFileSync(first.rulesPath, "# Hand written rules\n", "utf8")

		const second = initializeWorkspaceLayout({ targetDir: root, name: "replacement" })

		expect(readFileSync(first.workspaceJsonPath, "utf8")).toBe(readFileSync(second.workspaceJsonPath, "utf8"))
		expect(JSON.parse(readFileSync(second.workspaceJsonPath, "utf8"))).toEqual({ name: "original" })
		expect(readFileSync(second.rulesPath, "utf8")).toBe("# Hand written rules\n")
	})

	it("makes the directory resolve as an initialized workspace", () => {
		const root = createRoot()
		expect(resolveWorkspaceHierarchyInfo(root).isInitialized).toBe(false)

		initializeWorkspaceLayout({ targetDir: root, name: "fresh-workspace" })

		const info = resolveWorkspaceHierarchyInfo(root)
		expect(info.isInitialized).toBe(true)
		expect(info.primaryRoot).toBe(root)
		expect(info.layers[0].displayName).toBe("fresh-workspace")
	})
})
