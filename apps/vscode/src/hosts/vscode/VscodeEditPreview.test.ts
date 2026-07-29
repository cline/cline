import { afterEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"
import { VscodeEditPreview } from "./VscodeEditPreview"

describe("VscodeEditPreview", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("opens edit previews without taking keyboard focus", async () => {
		const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
		const preview = new VscodeEditPreview()

		await preview.open({
			title: "example.ts: Original ↔ Cline's Changes (Preview)",
			absolutePath: "/workspace/example.ts",
			displayPath: "example.ts",
			leftContent: "before",
			rightContent: "after",
		})

		expect(executeCommand).toHaveBeenCalledWith(
			"vscode.diff",
			expect.any(vscode.Uri),
			expect.any(vscode.Uri),
			"example.ts: Original ↔ Cline's Changes (Preview)",
			{ preview: false, preserveFocus: true },
		)

		await preview.close()
	})
})
