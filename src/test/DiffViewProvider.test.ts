import * as assert from "assert"
import * as vscode from "vscode"
import { DiffViewProvider } from "../integrations/editor/DiffViewProvider"
import { DiffAnimationSettings } from "../shared/ChatSettings"

suite("DiffViewProvider Tests", () => {
	let provider: DiffViewProvider

	setup(() => {
		provider = new DiffViewProvider("/test/cwd")
	})

	test("Animation settings are initialized correctly", () => {
		const settings = (provider as any).animationSettings as DiffAnimationSettings
		assert.strictEqual(settings.mode, "all")
		assert.strictEqual(settings.speed, "normal")
	})

	test("shouldAnimateLine - Always returns false in 'none' mode", () => {
		;(provider as any).animationSettings = {
			mode: "none",
			speed: "normal",
		}
		assert.strictEqual((provider as any).shouldAnimateLine(0), false)
	})

	test("shouldAnimateLine - Always returns true in 'all' mode", () => {
		;(provider as any).animationSettings = {
			mode: "all",
			speed: "normal",
		}
		assert.strictEqual((provider as any).shouldAnimateLine(0), true)
	})

	test("shouldAnimateLine - Returns true for a new file in 'changes-only' mode", () => {
		;(provider as any).animationSettings = {
			mode: "changes-only",
			speed: "normal",
		}
		;(provider as any).originalContent = undefined
		assert.strictEqual((provider as any).shouldAnimateLine(0), true)
	})

	test("shouldAnimateLine - Returns true for modified lines in 'changes-only' mode", () => {
		;(provider as any).animationSettings = {
			mode: "changes-only",
			speed: "normal",
		}
		;(provider as any).originalContent = "line1\nline2\nline3"
		;(provider as any).streamedLines = ["line1", "modified", "line3"]
		assert.strictEqual((provider as any).shouldAnimateLine(1), true) // Modified line
		assert.strictEqual((provider as any).shouldAnimateLine(0), false) // Unchanged line
	})

	test("Configuration changes are correctly applied", async () => {
		// Update settings
		await vscode.workspace.getConfiguration("cline").update("diffAnimation", {
			mode: "changes-only",
			speed: "4x",
		})

		// Wait for settings to be applied
		await new Promise((resolve) => setTimeout(resolve, 100))

		const settings = (provider as any).animationSettings as DiffAnimationSettings
		assert.strictEqual(settings.mode, "changes-only")
		assert.strictEqual(settings.speed, "fast")

		// Restore original settings
		await vscode.workspace.getConfiguration("cline").update("diffAnimation", {
			mode: "all",
			speed: "normal",
		})
	})

	test("Appropriate delay is applied based on animation speed", async () => {
		const startTime = Date.now()
		;(provider as any).animationSettings = {
			mode: "all",
			speed: "2x",
		}
		await (provider as any).applyAnimationDelay()
		const duration = Date.now() - startTime
		assert.ok(duration >= 50, "Delay should be at least 50ms")
	})
})
