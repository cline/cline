import type { AgentToolContext, ApplyPatchExecutor, EditFileInput, EditorExecutor } from "@cline/core"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest"
import { EditPreview, type EditPreviewContent } from "@/integrations/editor/EditPreview"
import { computeNewEditorContent, SdkDiffEditCoordinator } from "./sdk-diff-edit-coordinator"

/** Records open/close calls; previews are purely visual so no other behavior is needed. */
class FakeEditPreview extends EditPreview {
	opened: EditPreviewContent | undefined
	closed = 0
	failOpen = false

	override async open(content: EditPreviewContent): Promise<void> {
		if (this.failOpen) {
			throw new Error("fake open failure")
		}
		this.opened = content
	}

	override async close(): Promise<void> {
		this.closed++
	}
}

function makeContext(toolCallId: string, signal?: AbortSignal): AgentToolContext {
	return { agentId: "agent", iteration: 1, toolCallId, signal }
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("computeNewEditorContent", () => {
	const filePath = "/tmp/example.ts"

	it("replaces a single occurrence", () => {
		const input: EditFileInput = { path: filePath, old_text: "b", new_text: "x" }
		expect(computeNewEditorContent("a\nb\nc", input, filePath, "modify")).toBe("a\nx\nc")
	})

	it("returns new_text verbatim for created files", () => {
		const input: EditFileInput = { path: filePath, new_text: "hello" }
		expect(computeNewEditorContent("", input, filePath, "create")).toBe("hello")
	})

	it("inserts before the one-based boundary line", () => {
		const input: EditFileInput = { path: filePath, new_text: "x", insert_line: 2 }
		expect(computeNewEditorContent("a\nb", input, filePath, "modify")).toBe("a\nx\nb")
	})

	it("appends at EOF via line_count + 1", () => {
		const input: EditFileInput = { path: filePath, new_text: "x", insert_line: 3 }
		expect(computeNewEditorContent("a\nb", input, filePath, "modify")).toBe("a\nb\nx")
	})

	// Mirrors the SDK executor's semantics (editor.ts) so the preview shows exactly what
	// the executor will write, and inputs the SDK would reject skip the preview.
	it("throws for text not found", () => {
		const input: EditFileInput = { path: filePath, old_text: "zzz", new_text: "x" }
		expect(() => computeNewEditorContent("a\nb", input, filePath, "modify")).toThrow(
			`No replacement performed: text not found in ${filePath}.`,
		)
	})

	it("throws for ambiguous text", () => {
		const input: EditFileInput = { path: filePath, old_text: "a", new_text: "x" }
		expect(() => computeNewEditorContent("a\na", input, filePath, "modify")).toThrow(
			`No replacement performed: multiple occurrences of text found in ${filePath}.`,
		)
	})

	it("throws for missing old_text on an existing file", () => {
		const input: EditFileInput = { path: filePath, new_text: "x" }
		expect(() => computeNewEditorContent("a", input, filePath, "modify")).toThrow(
			"Parameter `old_text` is required when editing an existing file without `insert_line`",
		)
	})

	it("throws for an out-of-range insert_line", () => {
		const input: EditFileInput = { path: filePath, new_text: "x", insert_line: 5 }
		expect(() => computeNewEditorContent("a\nb", input, filePath, "modify")).toThrow(
			"Invalid insert_line: 5. insert_line must be a positive one-based boundary line in the range 1-3. Use 3 to append at EOF.",
		)
	})
})

describe("SdkDiffEditCoordinator", () => {
	let tempDir: string
	let previews: FakeEditPreview[]
	let previewTweak: ((preview: FakeEditPreview) => void) | undefined
	let backgroundEdit: boolean
	let fallbackEditor: Mock<EditorExecutor>
	let fallbackApplyPatch: Mock<ApplyPatchExecutor>
	let coordinator: SdkDiffEditCoordinator

	function makeCoordinator(
		overrides?: Partial<ConstructorParameters<typeof SdkDiffEditCoordinator>[0]>,
	): SdkDiffEditCoordinator {
		return new SdkDiffEditCoordinator({
			getCwd: async () => tempDir,
			isBackgroundEditEnabled: () => backgroundEdit,
			createEditPreview: () => {
				const preview = new FakeEditPreview()
				previewTweak?.(preview)
				previews.push(preview)
				return preview
			},
			fallbackEditorExecutor: fallbackEditor,
			fallbackApplyPatchExecutor: fallbackApplyPatch,
			autoApprovePreviewLingerMs: 0,
			...overrides,
		})
	}

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "diff-edit-test-"))
		previews = []
		previewTweak = undefined
		backgroundEdit = false
		fallbackEditor = vi.fn<EditorExecutor>().mockResolvedValue("fallback editor result")
		fallbackApplyPatch = vi.fn<ApplyPatchExecutor>().mockResolvedValue("fallback apply_patch result")
		coordinator = makeCoordinator()
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	async function writeFile(name: string, content: string): Promise<string> {
		const absolutePath = path.join(tempDir, name)
		await fs.writeFile(absolutePath, content)
		return absolutePath
	}

	it("opens a populated preview before approval for an existing-file edit", async () => {
		await writeFile("a.ts", "line1\nline2\n")
		await coordinator.openForApproval("tc1", "editor", { path: "a.ts", old_text: "line1", new_text: "changed" })

		expect(previews).toHaveLength(1)
		expect(previews[0].opened).toMatchObject({
			absolutePath: path.join(tempDir, "a.ts"),
			displayPath: "a.ts",
			leftContent: "line1\nline2\n",
			rightContent: "changed\nline2\n",
			title: "a.ts: Original ↔ Cline's Changes (Preview)",
		})
	})

	it("previews new files with an empty left side and skips insert into missing files", async () => {
		await coordinator.openForApproval("tc1", "editor", { path: "new.ts", new_text: "content" })
		expect(previews[0].opened).toMatchObject({
			leftContent: "",
			rightContent: "content",
			title: "new.ts: New File (Preview)",
		})

		await coordinator.openForApproval("tc2", "editor", { path: "missing.ts", new_text: "x", insert_line: 1 })
		expect(previews).toHaveLength(1) // no second preview
	})

	it("does not open previews when background edit is enabled", async () => {
		backgroundEdit = true
		await writeFile("a.ts", "content")
		await coordinator.openForApproval("tc1", "editor", { path: "a.ts", old_text: "content", new_text: "x" })
		expect(previews).toHaveLength(0)
	})

	it("never throws from openForApproval and the executor still applies the edit", async () => {
		await writeFile("a.ts", "content")
		// old_text won't match — computeNewEditorContent throws, preview is skipped
		await coordinator.openForApproval("tc1", "editor", { path: "a.ts", old_text: "nope", new_text: "x" })
		expect(previews).toHaveLength(0)

		// the executor delegates to the disk executor, which produces the canonical error
		const input = { path: "a.ts", old_text: "nope", new_text: "x" }
		fallbackEditor.mockRejectedValueOnce(new Error("No replacement performed: text not found in a.ts."))
		await expect(coordinator.executeEditorTool(input, tempDir, makeContext("tc1"))).rejects.toThrow(
			"No replacement performed: text not found",
		)
	})

	it("closes the pre-approval preview and delegates the write on execution", async () => {
		await writeFile("a.ts", "old content")
		const input = { path: "a.ts", old_text: "old", new_text: "new" }
		await coordinator.openForApproval("tc1", "editor", input)
		expect(previews[0].closed).toBe(0)

		const result = await coordinator.executeEditorTool(input, tempDir, makeContext("tc1"))

		expect(result).toBe("fallback editor result")
		expect(fallbackEditor).toHaveBeenCalledWith(input, tempDir, expect.objectContaining({ toolCallId: "tc1" }))
		expect(previews[0].closed).toBe(1)
	})

	it("closes the preview even when the write fails", async () => {
		await writeFile("a.ts", "old content")
		const input = { path: "a.ts", old_text: "old", new_text: "new" }
		await coordinator.openForApproval("tc1", "editor", input)
		fallbackEditor.mockRejectedValueOnce(new Error("disk full"))

		await expect(coordinator.executeEditorTool(input, tempDir, makeContext("tc1"))).rejects.toThrow("disk full")
		expect(previews[0].closed).toBe(1)
	})

	it("shows a brief preview around auto-approved edits and lingers after the write", async () => {
		coordinator = makeCoordinator({ autoApprovePreviewLingerMs: 150 })
		await writeFile("a.ts", "old content")
		const input = { path: "a.ts", old_text: "old", new_text: "new" }

		let settled = false
		const promise = coordinator.executeEditorTool(input, tempDir, makeContext("tc1")).then((r) => {
			settled = true
			return r
		})
		await sleep(50)
		// Write already delegated; executor is lingering with the preview open.
		expect(previews).toHaveLength(1)
		expect(fallbackEditor).toHaveBeenCalledOnce()
		expect(previews[0].closed).toBe(0)
		expect(settled).toBe(false)

		expect(await promise).toBe("fallback editor result")
		expect(previews[0].closed).toBe(1)
	})

	it("cuts the auto-approve linger short on abort without failing the applied edit", async () => {
		coordinator = makeCoordinator({ autoApprovePreviewLingerMs: 10_000 })
		await writeFile("a.ts", "old content")
		const input = { path: "a.ts", old_text: "old", new_text: "new" }
		const controller = new AbortController()

		const promise = coordinator.executeEditorTool(input, tempDir, makeContext("tc1", controller.signal))
		await sleep(50)
		controller.abort()

		expect(await promise).toBe("fallback editor result")
		expect(previews[0].closed).toBe(1)
	})

	it("still applies auto-approved edits when the preview fails to open", async () => {
		previewTweak = (preview) => {
			preview.failOpen = true
		}
		await writeFile("a.ts", "old content")
		const input = { path: "a.ts", old_text: "old", new_text: "new" }

		const result = await coordinator.executeEditorTool(input, tempDir, makeContext("tc1"))
		expect(result).toBe("fallback editor result")
	})

	it("delegates directly with no preview when background edit is enabled", async () => {
		backgroundEdit = true
		await writeFile("a.ts", "old content")
		const input = { path: "a.ts", old_text: "old", new_text: "new" }

		const result = await coordinator.executeEditorTool(input, tempDir, makeContext("tc1"))

		expect(result).toBe("fallback editor result")
		expect(previews).toHaveLength(0)
	})

	it("supersedes a pending same-file preview and the earlier executor does not reopen one", async () => {
		await writeFile("a.ts", "alpha\nshared\n")
		const first = { path: "a.ts", old_text: "alpha", new_text: "ALPHA" }
		const second = { path: "a.ts", old_text: "shared", new_text: "SHARED" }
		await coordinator.openForApproval("tc1", "editor", first)
		await coordinator.openForApproval("tc2", "editor", second)

		// Preview #1's tab was closed when #2 opened for the same file.
		expect(previews[0].closed).toBe(1)
		expect(previews[1].opened?.rightContent).toBe("alpha\nSHARED\n")

		// Executor #1 (session tombstoned) writes without opening a fresh auto-approve preview.
		const result = await coordinator.executeEditorTool(first, tempDir, makeContext("tc1"))
		expect(result).toBe("fallback editor result")
		expect(previews).toHaveLength(2)

		// Executor #2 closes its own preview.
		await coordinator.executeEditorTool(second, tempDir, makeContext("tc2"))
		expect(previews[1].closed).toBe(1)
	})

	it("discards previews on denial and discardAllPreviews closes everything", async () => {
		await writeFile("a.ts", "old content")
		await writeFile("b.ts", "other content")
		await coordinator.openForApproval("tc1", "editor", { path: "a.ts", old_text: "old", new_text: "new" })
		await coordinator.openForApproval("tc2", "editor", { path: "b.ts", old_text: "other", new_text: "new" })

		await coordinator.discardPreview("tc1")
		expect(previews[0].closed).toBe(1)
		await coordinator.discardPreview("tc1") // unknown/already-discarded id is a no-op
		expect(previews[0].closed).toBe(1)

		await coordinator.discardAllPreviews("test cleanup")
		expect(previews[1].closed).toBe(1)
	})

	it("previews the first file of an apply_patch and closes it before the default executor runs", async () => {
		await writeFile("patched.ts", "line one\nline two\n")
		const patch = ["*** Begin Patch", "*** Update File: patched.ts", "@@", "-line one", "+line ONE", "*** End Patch"].join(
			"\n",
		)

		await coordinator.openForApproval("tc1", "apply_patch", { input: patch })

		expect(previews).toHaveLength(1)
		expect(previews[0].opened).toMatchObject({
			absolutePath: path.join(tempDir, "patched.ts"),
			displayPath: "patched.ts",
			leftContent: "line one\nline two\n",
			rightContent: "line ONE\nline two\n",
		})

		const callOrder: string[] = []
		fallbackApplyPatch.mockImplementation(async () => {
			callOrder.push("apply")
			return "patch applied"
		})
		const originalClose = previews[0].close.bind(previews[0])
		previews[0].close = async () => {
			callOrder.push("close")
			await originalClose()
		}

		const result = await coordinator.executeApplyPatchTool({ input: patch }, tempDir, makeContext("tc1"))

		expect(result).toBe("patch applied")
		expect(callOrder).toEqual(["close", "apply"])
	})

	it("applies patches without preview sessions directly", async () => {
		const result = await coordinator.executeApplyPatchTool(
			{ input: "*** Begin Patch\n*** End Patch" },
			tempDir,
			makeContext("tc9"),
		)
		expect(result).toBe("fallback apply_patch result")
		expect(fallbackApplyPatch).toHaveBeenCalledOnce()
	})
})
