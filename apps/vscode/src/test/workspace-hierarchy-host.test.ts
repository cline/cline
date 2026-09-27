import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveHierarchicalWorkspaceSync } from "@cline/shared"
import { after, before, describe, it } from "mocha"
import * as vscode from "vscode"

/**
 * RFC 0001 §4 — host verification of hierarchical workspace resolution.
 *
 * The pure resolver and the status-bar copy are covered by vitest
 * (`workspace-hierarchy.test.ts`). This suite runs inside the real VS Code
 * extension host to confirm the parts that only exist there: that activation
 * actually registers the workspace status-bar command, and that the same
 * resolver the status bar, history scope, and onboarding card consume resolves
 * correctly against the live filesystem (including symlink-loop safety, which
 * the pure tests can only simulate).
 *
 * It deliberately does not open a second window or drive the status-bar item
 * directly: the item lives inside the bundled extension host, which a test
 * module cannot observe. The registered command is the observable proof that
 * the indicator was created during activation.
 */

const WORKSPACE_STATUS_BAR_COMMAND = "cline.workspaceHierarchyClicked"

const tempRoots: string[] = []

before(() => {
	// Activation is what creates the status bar; give it a moment to settle the
	// way the other host tests do before asserting on registered commands.
})

after(() => {
	for (const dir of tempRoots) {
		rmSync(dir, { recursive: true, force: true })
	}
	tempRoots.length = 0
})

function createRoot(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "cline-workspace-host-")))
	tempRoots.push(dir)
	return dir
}

function addWorkspace(dir: string, name: string): void {
	const clineDir = join(dir, ".cline")
	mkdirSync(clineDir, { recursive: true })
	writeFileSync(join(clineDir, "workspace.json"), JSON.stringify({ name }), "utf8")
}

describe("Hierarchical workspace host verification", () => {
	it("registers the workspace status bar command during activation", async () => {
		await new Promise((resolve) => setTimeout(resolve, 400))
		const commands = await vscode.commands.getCommands(true)
		commands.should.containEql(WORKSPACE_STATUS_BAR_COMMAND)
	})

	it("resolves an inherited sub-cline against the real filesystem", () => {
		const repo = createRoot()
		addWorkspace(repo, "monorepo")
		mkdirSync(join(repo, ".git"), { recursive: true })
		const cli = join(repo, "apps", "cli")
		mkdirSync(cli, { recursive: true })
		addWorkspace(cli, "apps-cli")

		const resolved = resolveHierarchicalWorkspaceSync(join(cli, "src"))

		resolved.primaryRoot.should.equal(cli)
		resolved.layers.map((layer) => layer.path).should.eql([repo, cli])
		resolved.isInitialized.should.equal(true)
	})

	it("stops inheritance at an isolation boundary", () => {
		const repo = createRoot()
		addWorkspace(repo, "monorepo")
		const sealed = join(repo, "sealed")
		mkdirSync(sealed, { recursive: true })
		addWorkspace(sealed, "sealed-service")
		writeFileSync(join(sealed, ".cline-boundary"), "", "utf8")

		const resolved = resolveHierarchicalWorkspaceSync(join(sealed, "src"))

		resolved.primaryRoot.should.equal(sealed)
		resolved.layers.map((layer) => layer.path).should.eql([sealed])
	})

	it("terminates instead of looping when a directory symlinks to an ancestor", () => {
		const repo = createRoot()
		addWorkspace(repo, "monorepo")
		const loop = join(repo, "loop")
		mkdirSync(loop, { recursive: true })
		addWorkspace(loop, "looped")
		symlinkSync(repo, join(loop, "back-to-root"))

		const resolved = resolveHierarchicalWorkspaceSync(loop)

		resolved.primaryRoot.should.equal(loop)
		resolved.layers.map((layer) => layer.path).should.containEql(repo)
		resolved.layers.length.should.be.below(8)
	})
})
