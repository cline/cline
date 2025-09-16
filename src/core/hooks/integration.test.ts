/**
 * Integration tests for Hook System
 */

import { ToolUse } from "@core/assistant-message"
import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import * as sinon from "sinon"
import { ClineDefaultTool } from "@/shared/tools"
import { HookManager } from "./HookManager"

describe("Hook System Integration", () => {
	let tempDir: string
	let hookManager: HookManager
	let sandbox: sinon.SinonSandbox

	beforeEach(async () => {
		sandbox = sinon.createSandbox()

		// Create temp directory for test hooks
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hook-test-"))

		// Initialize HookManager with test directory
		hookManager = new HookManager("test-task", tempDir, {
			debug: false,
		})
	})

	afterEach(async () => {
		sandbox.restore()
		// Clean up temp directory
		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch {}
	})

	describe("End-to-end hook execution", () => {
		it("should execute a simple PreToolUse hook", async () => {
			// Create a simple hook script
			const hookScript = `#!/usr/bin/env node
const fs = require('fs');
const event = JSON.parse(fs.readFileSync(0, 'utf-8'));

// Simple approval with message
console.log(JSON.stringify({
	approve: true,
	message: "Hook approved tool: " + event.tool_name
}));
`
			const hookPath = path.join(tempDir, "pre-tool-hook.js")
			await fs.writeFile(hookPath, hookScript, { mode: 0o755 })

			// Create cline_settings.json
			const config = {
				hooks: {
					PreToolUse: [
						{
							matcher: "*",
							hooks: [
								{
									type: "command",
									command: "node " + hookPath,
								},
							],
						},
					],
				},
			}
			await fs.writeFile(path.join(tempDir, ".cline", "settings.json"), JSON.stringify(config, null, 2))

			// Create tool block
			const toolBlock: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.FILE_READ,
				params: { path: "/test.txt" },
				partial: false,
			}

			// Execute hook
			const result = await hookManager.executePreToolUseHooks(toolBlock)

			expect(result).to.not.be.null
			expect(result?.approve).to.be.true
			expect(result?.messages).to.include("Hook approved tool: Read")
		})

		it("should handle hook denial", async () => {
			// Create a denying hook script
			const hookScript = `#!/usr/bin/env node
const fs = require('fs');
const event = JSON.parse(fs.readFileSync(0, 'utf-8'));

// Deny with reason
console.log(JSON.stringify({
	approve: false,
	message: "Access denied to sensitive file"
}));
`
			const hookPath = path.join(tempDir, "deny-hook.js")
			await fs.writeFile(hookPath, hookScript, { mode: 0o755 })

			// Create cline_settings.json
			const config = {
				hooks: {
					PreToolUse: [
						{
							matcher: "Write",
							hooks: [
								{
									type: "command",
									command: "node " + hookPath,
								},
							],
						},
					],
				},
			}
			await fs.writeFile(path.join(tempDir, ".cline", "settings.json"), JSON.stringify(config, null, 2))

			// Create tool block
			const toolBlock: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.FILE_NEW,
				params: { path: "/etc/passwd", content: "hacked" },
				partial: false,
			}

			// Execute hook
			const result = await hookManager.executePreToolUseHooks(toolBlock)

			expect(result).to.not.be.null
			expect(result?.approve).to.be.false
			expect(result?.messages).to.include("Access denied to sensitive file")
		})

		it("should modify tool input", async () => {
			// Create a modifying hook script
			const hookScript = `#!/usr/bin/env node
const fs = require('fs');
const event = JSON.parse(fs.readFileSync(0, 'utf-8'));

// Approve with modification
console.log(JSON.stringify({
	approve: true,
	modifiedInput: {
		path: event.tool_input.path + ".safe"
	}
}));
`
			const hookPath = path.join(tempDir, "modify-hook.js")
			await fs.writeFile(hookPath, hookScript, { mode: 0o755 })

			// Create cline_settings.json
			const config = {
				hooks: {
					PreToolUse: [
						{
							matcher: "*",
							hooks: [
								{
									type: "command",
									command: "node " + hookPath,
								},
							],
						},
					],
				},
			}
			await fs.writeFile(path.join(tempDir, ".cline", "settings.json"), JSON.stringify(config, null, 2))

			// Create tool block
			const toolBlock: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.FILE_NEW,
				params: { path: "/dangerous.txt", content: "test" },
				partial: false,
			}

			// Execute hook
			const result = await hookManager.executePreToolUseHooks(toolBlock)

			expect(result).to.not.be.null
			expect(result?.approve).to.be.true
			expect(result?.modifiedInput).to.deep.equal({
				path: "/dangerous.txt.safe",
			})
		})

		it("should handle UserPromptSubmit hooks", async () => {
			// Create a prompt hook script
			const hookScript = `#!/usr/bin/env node
const fs = require('fs');
const event = JSON.parse(fs.readFileSync(0, 'utf-8'));

// Add context to prompt
console.log(JSON.stringify({
	approve: true,
	additionalContext: "User is working on: " + event.cwd
}));
`
			const hookPath = path.join(tempDir, "prompt-hook.js")
			await fs.writeFile(hookPath, hookScript, { mode: 0o755 })

			// Create cline_settings.json
			const config = {
				hooks: {
					UserPromptSubmit: [
						{
							matcher: "*",
							hooks: [
								{
									type: "command",
									command: "node " + hookPath,
								},
							],
						},
					],
				},
			}
			await fs.writeFile(path.join(tempDir, ".cline", "settings.json"), JSON.stringify(config, null, 2))

			// Execute hook
			const result = await hookManager.executeUserPromptSubmitHooks("Test prompt")

			expect(result).to.not.be.null
			expect(result?.approve).to.be.true
			expect(result?.additionalContext).to.include("User is working on: " + tempDir)
		})

		it("should handle multiple hooks with aggregation", async () => {
			// Create two hook scripts
			const hook1Script = `#!/usr/bin/env node
console.log(JSON.stringify({
	approve: true,
	message: "Hook 1 approved"
}));
`
			const hook2Script = `#!/usr/bin/env node
console.log(JSON.stringify({
	approve: true,
	message: "Hook 2 approved"
}));
`
			const hook1Path = path.join(tempDir, "hook1.js")
			const hook2Path = path.join(tempDir, "hook2.js")
			await fs.writeFile(hook1Path, hook1Script, { mode: 0o755 })
			await fs.writeFile(hook2Path, hook2Script, { mode: 0o755 })

			// Create cline_settings.json with multiple hooks
			const config = {
				hooks: {
					PreToolUse: [
						{
							matcher: "*",
							hooks: [
								{
									type: "command",
									command: "node " + hook1Path,
								},
								{
									type: "command",
									command: "node " + hook2Path,
								},
							],
						},
					],
				},
			}
			await fs.writeFile(path.join(tempDir, ".cline", "settings.json"), JSON.stringify(config, null, 2))

			// Create tool block
			const toolBlock: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.FILE_READ,
				params: { path: "/test.txt" },
				partial: false,
			}

			// Execute hooks
			const result = await hookManager.executePreToolUseHooks(toolBlock)

			expect(result).to.not.be.null
			expect(result?.approve).to.be.true
			expect(result?.messages).to.have.length(2)
			expect(result?.messages).to.include("Hook 1 approved")
			expect(result?.messages).to.include("Hook 2 approved")
		})

		it("should handle hook timeout", async () => {
			// Create a slow hook script
			const hookScript = `#!/usr/bin/env node
// Sleep for longer than timeout
setTimeout(() => {
	console.log(JSON.stringify({ approve: true }));
	process.exit(0);
}, 5000);
`
			const hookPath = path.join(tempDir, "slow-hook.js")
			await fs.writeFile(hookPath, hookScript, { mode: 0o755 })

			// Create cline_settings.json with low timeout
			const config = {
				hooks: {
					PreToolUse: [
						{
							matcher: "*",
							hooks: [
								{
									type: "command",
									command: "node " + hookPath,
									timeout: 1, // 1 second timeout
								},
							],
						},
					],
				},
			}
			await fs.writeFile(path.join(tempDir, ".cline", "settings.json"), JSON.stringify(config, null, 2))

			// Create tool block
			const toolBlock: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.FILE_READ,
				params: { path: "/test.txt" },
				partial: false,
			}

			// Execute hook - should timeout
			const result = await hookManager.executePreToolUseHooks(toolBlock)

			// Hook should timeout and return null (no hooks executed successfully)
			expect(result).to.be.null
		})

		it("should execute SessionStart and SessionEnd hooks", async () => {
			// Create session hooks
			const sessionStartScript = `#!/usr/bin/env node
const fs = require('fs');
const event = JSON.parse(fs.readFileSync(0, 'utf-8'));
console.log(JSON.stringify({
	approve: true,
	message: "Session started: " + event.source
}));
`
			const sessionEndScript = `#!/usr/bin/env node
const fs = require('fs');
const event = JSON.parse(fs.readFileSync(0, 'utf-8'));
console.log(JSON.stringify({
	approve: true,
	message: "Session ended"
}));
`
			const startPath = path.join(tempDir, "session-start.js")
			const endPath = path.join(tempDir, "session-end.js")
			await fs.writeFile(startPath, sessionStartScript, { mode: 0o755 })
			await fs.writeFile(endPath, sessionEndScript, { mode: 0o755 })

			// Create cline_settings.json
			const config = {
				hooks: {
					SessionStart: [
						{
							matcher: "*",
							hooks: [
								{
									type: "command",
									command: "node " + startPath,
								},
							],
						},
					],
					SessionEnd: [
						{
							matcher: "*",
							hooks: [
								{
									type: "command",
									command: "node " + endPath,
								},
							],
						},
					],
				},
			}
			await fs.writeFile(path.join(tempDir, ".cline", "settings.json"), JSON.stringify(config, null, 2))

			// Execute SessionStart hook
			const startResult = await hookManager.executeSessionStartHooks("startup")
			expect(startResult).to.not.be.null
			expect(startResult?.messages).to.include("Session started: startup")

			// Execute SessionEnd hook
			const endResult = await hookManager.executeSessionEndHooks()
			expect(endResult).to.not.be.null
			expect(endResult?.messages).to.include("Session ended")
		})
	})

	describe("Hook configuration", () => {
		it("should detect when hooks are enabled", async () => {
			// Initially no hooks
			let enabled = await hookManager.isEnabled()
			expect(enabled).to.be.false

			// Create cline_settings.json
			const config = {
				hooks: {
					PreToolUse: [
						{
							matcher: "*",
							hooks: [
								{
									type: "command",
									command: "echo '{\"approve\": true}'",
								},
							],
						},
					],
				},
			}
			await fs.mkdir(path.join(tempDir, ".cline"), { recursive: true })
			await fs.writeFile(path.join(tempDir, ".cline", "settings.json"), JSON.stringify(config, null, 2))

			// Reload configuration
			await hookManager.reloadConfiguration()

			// Now hooks should be enabled
			enabled = await hookManager.isEnabled()
			expect(enabled).to.be.true
		})

		it("should support pattern matching", async () => {
			// Create hook that only matches Write tool
			const hookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
	approve: false,
	message: "Write operations blocked"
}));
`
			const hookPath = path.join(tempDir, "write-block.js")
			await fs.writeFile(hookPath, hookScript, { mode: 0o755 })

			// Create cline_settings.json
			const config = {
				hooks: {
					PreToolUse: [
						{
							matcher: "Write",
							hooks: [
								{
									type: "command",
									command: "node " + hookPath,
								},
							],
						},
					],
				},
			}
			await fs.mkdir(path.join(tempDir, ".cline"), { recursive: true })
			await fs.writeFile(path.join(tempDir, ".cline", "settings.json"), JSON.stringify(config, null, 2))

			// Test with Read tool - should not match
			const readBlock: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.FILE_READ,
				params: { path: "/test.txt" },
				partial: false,
			}
			let result = await hookManager.executePreToolUseHooks(readBlock)
			expect(result).to.be.null // No matching hooks

			// Test with Write tool - should match
			const writeBlock: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.FILE_NEW,
				params: { path: "/test.txt", content: "data" },
				partial: false,
			}
			result = await hookManager.executePreToolUseHooks(writeBlock)
			expect(result).to.not.be.null
			expect(result?.approve).to.be.false
			expect(result?.messages).to.include("Write operations blocked")
		})
	})
})
