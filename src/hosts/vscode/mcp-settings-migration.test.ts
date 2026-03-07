import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import { createStorageContext, type StorageContext } from "@shared/storage/storage-context"
import fs from "fs"
import os from "os"
import path from "path"
import sinon from "sinon"
import {
	CURRENT_MCP_SETTINGS_MIGRATION_VERSION,
	MCP_SETTINGS_MIGRATION_VERSION_KEY,
	migrateMcpSettings,
} from "./mcp-settings-migration"

/**
 * Create a minimal mock of VSCode's ExtensionContext for MCP migration testing.
 * Only provides the globalStorageUri.fsPath needed by migrateMcpSettings.
 */
function createMockVSCodeContext(globalStorageFsPath: string) {
	return {
		globalStorageUri: { fsPath: globalStorageFsPath },
	} as any
}

describe("MCP settings migration", () => {
	let sandbox: sinon.SinonSandbox
	let tempDir: string
	let storageContext: StorageContext

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		tempDir = path.join(os.tmpdir(), `mcp-migration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		fs.mkdirSync(tempDir, { recursive: true })

		storageContext = createStorageContext({
			clineDir: tempDir,
			workspacePath: tempDir,
		})
	})

	afterEach(() => {
		sandbox.restore()
		try {
			fs.rmSync(tempDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	it("should copy MCP settings when destination has no file", async () => {
		// Create a fake VSCode globalStorage with an MCP settings file
		const vscodeStorageDir = path.join(tempDir, "vscode-storage")
		const vscodeSettingsDir = path.join(vscodeStorageDir, "settings")
		fs.mkdirSync(vscodeSettingsDir, { recursive: true })
		const mcpData = { mcpServers: { "test-server": { command: "node", args: ["server.js"] } } }
		fs.writeFileSync(path.join(vscodeSettingsDir, "cline_mcp_settings.json"), JSON.stringify(mcpData))

		const migrated = await migrateMcpSettings(createMockVSCodeContext(vscodeStorageDir), storageContext)

		migrated.should.be.true()

		// MCP settings should be copied to shared location
		const destPath = path.join(storageContext.dataDir, "settings", "cline_mcp_settings.json")
		fs.existsSync(destPath).should.be.true()
		const copied = JSON.parse(fs.readFileSync(destPath, "utf8"))
		copied.mcpServers["test-server"].command.should.equal("node")

		// Sentinel should be written
		storageContext.globalState
			.get<number>(MCP_SETTINGS_MIGRATION_VERSION_KEY)!
			.should.equal(CURRENT_MCP_SETTINGS_MIGRATION_VERSION)
	})

	it("should skip MCP copy when destination already has servers configured", async () => {
		// Create VSCode source with server-a
		const vscodeStorageDir = path.join(tempDir, "vscode-storage")
		const vscodeSettingsDir = path.join(vscodeStorageDir, "settings")
		fs.mkdirSync(vscodeSettingsDir, { recursive: true })
		const srcData = {
			mcpServers: {
				"server-a": { command: "node", args: ["a.js"] },
			},
		}
		fs.writeFileSync(path.join(vscodeSettingsDir, "cline_mcp_settings.json"), JSON.stringify(srcData))

		// Create shared destination that already has servers (destination wins)
		const sharedSettingsDir = path.join(storageContext.dataDir, "settings")
		fs.mkdirSync(sharedSettingsDir, { recursive: true })
		const destData = {
			mcpServers: {
				"server-b": { command: "python", args: ["b.py"] },
			},
		}
		fs.writeFileSync(path.join(sharedSettingsDir, "cline_mcp_settings.json"), JSON.stringify(destData))

		const migrated = await migrateMcpSettings(createMockVSCodeContext(vscodeStorageDir), storageContext)

		migrated.should.be.true()

		// Destination should be unchanged — source was NOT copied over
		const afterMigration = JSON.parse(fs.readFileSync(path.join(sharedSettingsDir, "cline_mcp_settings.json"), "utf8"))
		Object.keys(afterMigration.mcpServers).length.should.equal(1)
		afterMigration.mcpServers["server-b"].command.should.equal("python")
		// server-a should NOT have been added
		;(afterMigration.mcpServers["server-a"] === undefined).should.be.true()
	})

	it("should copy MCP file even when source has no servers (dest empty)", async () => {
		const vscodeStorageDir = path.join(tempDir, "vscode-storage")
		const vscodeSettingsDir = path.join(vscodeStorageDir, "settings")
		fs.mkdirSync(vscodeSettingsDir, { recursive: true })
		fs.writeFileSync(path.join(vscodeSettingsDir, "cline_mcp_settings.json"), JSON.stringify({ mcpServers: {} }))

		const migrated = await migrateMcpSettings(createMockVSCodeContext(vscodeStorageDir), storageContext)

		migrated.should.be.true()

		// File gets copied because destination has no servers (the check is on dest, not source)
		const destPath = path.join(storageContext.dataDir, "settings", "cline_mcp_settings.json")
		fs.existsSync(destPath).should.be.true()
		const data = JSON.parse(fs.readFileSync(destPath, "utf8"))
		Object.keys(data.mcpServers).length.should.equal(0)
	})

	it("should skip MCP migration when source file does not exist", async () => {
		const vscodeStorageDir = path.join(tempDir, "vscode-storage")
		// Don't create settings dir — no source file

		const migrated = await migrateMcpSettings(createMockVSCodeContext(vscodeStorageDir), storageContext)

		migrated.should.be.true()

		// No file should be created
		const destPath = path.join(storageContext.dataDir, "settings", "cline_mcp_settings.json")
		fs.existsSync(destPath).should.be.false()

		// Sentinel should still be written
		storageContext.globalState
			.get<number>(MCP_SETTINGS_MIGRATION_VERSION_KEY)!
			.should.equal(CURRENT_MCP_SETTINGS_MIGRATION_VERSION)
	})

	it("should skip MCP migration when source and dest are the same path", async () => {
		// Point vscodeGlobalStoragePath to the same base as the shared storage (CLI case)
		const sharedSettingsDir = path.join(storageContext.dataDir, "settings")
		fs.mkdirSync(sharedSettingsDir, { recursive: true })
		const original = { mcpServers: { existing: { command: "echo" } } }
		fs.writeFileSync(path.join(sharedSettingsDir, "cline_mcp_settings.json"), JSON.stringify(original))

		const migrated = await migrateMcpSettings(createMockVSCodeContext(storageContext.dataDir), storageContext)

		migrated.should.be.true()

		// File should be unchanged
		const data = JSON.parse(fs.readFileSync(path.join(sharedSettingsDir, "cline_mcp_settings.json"), "utf8"))
		data.mcpServers.existing.command.should.equal("echo")
		Object.keys(data.mcpServers).length.should.equal(1)
	})

	it("should not fail if MCP file copy fails", async () => {
		const vscodeStorageDir = path.join(tempDir, "vscode-storage")
		const vscodeSettingsDir = path.join(vscodeStorageDir, "settings")
		fs.mkdirSync(vscodeSettingsDir, { recursive: true })
		// Write invalid JSON to trigger a parse error on the source
		fs.writeFileSync(path.join(vscodeSettingsDir, "cline_mcp_settings.json"), "NOT VALID JSON")

		const migrated = await migrateMcpSettings(createMockVSCodeContext(vscodeStorageDir), storageContext)

		// Migration should still succeed (MCP step is non-fatal)
		migrated.should.be.true()

		// Sentinel should still be written
		storageContext.globalState
			.get<number>(MCP_SETTINGS_MIGRATION_VERSION_KEY)!
			.should.equal(CURRENT_MCP_SETTINGS_MIGRATION_VERSION)
	})

	it("should skip when sentinel is already at current version", async () => {
		storageContext.globalState.update(MCP_SETTINGS_MIGRATION_VERSION_KEY, CURRENT_MCP_SETTINGS_MIGRATION_VERSION)

		const vscodeStorageDir = path.join(tempDir, "vscode-storage")
		const vscodeSettingsDir = path.join(vscodeStorageDir, "settings")
		fs.mkdirSync(vscodeSettingsDir, { recursive: true })
		const mcpData = { mcpServers: { "test-server": { command: "node" } } }
		fs.writeFileSync(path.join(vscodeSettingsDir, "cline_mcp_settings.json"), JSON.stringify(mcpData))

		const migrated = await migrateMcpSettings(createMockVSCodeContext(vscodeStorageDir), storageContext)

		migrated.should.be.false()

		// No file should be created — migration was skipped
		const destPath = path.join(storageContext.dataDir, "settings", "cline_mcp_settings.json")
		fs.existsSync(destPath).should.be.false()
	})

	it("should re-run migration when sentinel is lower than current version", async () => {
		storageContext.globalState.update(MCP_SETTINGS_MIGRATION_VERSION_KEY, 0)

		const vscodeStorageDir = path.join(tempDir, "vscode-storage")
		const vscodeSettingsDir = path.join(vscodeStorageDir, "settings")
		fs.mkdirSync(vscodeSettingsDir, { recursive: true })
		const mcpData = { mcpServers: { "test-server": { command: "node" } } }
		fs.writeFileSync(path.join(vscodeSettingsDir, "cline_mcp_settings.json"), JSON.stringify(mcpData))

		const migrated = await migrateMcpSettings(createMockVSCodeContext(vscodeStorageDir), storageContext)

		migrated.should.be.true()

		const destPath = path.join(storageContext.dataDir, "settings", "cline_mcp_settings.json")
		fs.existsSync(destPath).should.be.true()
	})
})
