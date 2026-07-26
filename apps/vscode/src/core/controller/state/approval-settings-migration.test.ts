import fs from "node:fs/promises"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { getToolApprovalDecision } from "@cline/shared"
import { afterEach, describe, expect, it } from "vitest"
import { createStorageContext } from "@/shared/storage/storage-context"
import { migrateLegacyApprovalSettings } from "../../storage/approval-settings-migration"

describe("legacy approval settings migration", () => {
	let root = ""
	let originalMcpSettingsPath: string | undefined

	afterEach(() => {
		if (originalMcpSettingsPath === undefined) {
			delete process.env.CLINE_MCP_SETTINGS_PATH
		} else {
			process.env.CLINE_MCP_SETTINGS_PATH = originalMcpSettingsPath
		}
		if (root) rmSync(root, { recursive: true, force: true })
	})

	it("removes old grants without granting state-changing tools permission", async () => {
		root = mkdtempSync(path.join(os.tmpdir(), "phase5-approval-migration-"))
		const storage = createStorageContext({
			clineDir: path.join(root, ".cline"),
			workspacePath: path.join(root, "workspace"),
		})
		await storage.globalState.setBatch({
			autoApprovalSettings: { enabled: true },
			yoloModeToggled: true,
			unrelatedSetting: "keep",
		})
		await storage.workspaceState.setBatch({
			backgroundEditEnabled: true,
			unrelatedWorkspaceSetting: "keep",
		})
		const mcpPath = path.join(root, "mcp.json")
		originalMcpSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH
		process.env.CLINE_MCP_SETTINGS_PATH = mcpPath
		await fs.writeFile(
			mcpPath,
			JSON.stringify({
				mcpServers: {
					docs: {
						transport: { type: "streamableHttp", url: "https://example.com/mcp" },
						autoApprove: ["search"],
					},
				},
			}),
		)

		await migrateLegacyApprovalSettings(storage)

		expect(storage.globalState.get("autoApprovalSettings")).toBeUndefined()
		expect(storage.globalState.get("yoloModeToggled")).toBeUndefined()
		expect(storage.globalState.get("unrelatedSetting")).toBe("keep")
		expect(storage.workspaceState.get("backgroundEditEnabled")).toBeUndefined()
		expect(storage.workspaceState.get("unrelatedWorkspaceSetting")).toBe("keep")
		const mcp = JSON.parse(await fs.readFile(mcpPath, "utf8"))
		expect(mcp.mcpServers.docs.autoApprove).toBeUndefined()
		expect(getToolApprovalDecision({ toolName: "docs__search", mode: "act" })).toBe("require_approval")
	})
})
