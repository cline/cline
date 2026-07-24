import type { AgentToolContext, ApplyPatchExecutor, EditFileInput, EditorExecutor } from "@cline/core"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest"
import { buildEditPreviewAnimation, EditPreview, type EditPreviewContent } from "@/integrations/editor/EditPreview"
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

describe("buildEditPreviewAnimation", () => {
	it("types fully-changed content in line by line and ends exactly at rightContent", () => {
		const left = "one\ntwo\nthree\nfour"
		const right = "ONE\nTWO\nTHREE\nFOUR"
		const { frames, firstChangedLine } = buildEditPreviewAnimation(left, right)

		expect(firstChangedLine).toBe(0)
		expect(frames.map((f) => f.activeLine)).toEqual([0, 1, 2, 3])
		expect(frames.every((f) => !f.zip)).toBe(true)
		expect(frames[0].content).toBe("ONE\ntwo\nthree\nfour")
		expect(frames[frames.length - 1].content).toBe(right)
	})

	it("caps typing frames for large changes and still ends at rightContent", () => {
		const left = Array.from({ length: 500 }, (_, i) => `old ${i}`).join("\n")
		const right = Array.from({ length: 500 }, (_, i) => `new ${i}`).join("\n")
		const { frames } = buildEditPreviewAnimation(left, right)

		expect(frames.length).toBeLessThanOrEqual(40)
		expect(frames[frames.length - 1].content).toBe(right)
		// Intermediate frames are a prefix of the new content over the original's tail.
		expect(frames[0].content.startsWith("new 0\n")).toBe(true)
		expect(frames[0].content.endsWith("old 499")).toBe(true)
	})

	it("renders immediately when many small hunks would exceed the global animation budget", () => {
		const left = Array.from({ length: 3_000 }, (_, i) => (i < 10 || i % 2 !== 0 ? `same ${i}` : `old ${i}`)).join("\n")
		const right = Array.from({ length: 3_000 }, (_, i) => (i < 10 || i % 2 !== 0 ? `same ${i}` : `new ${i}`)).join("\n")

		const { frames, firstChangedLine } = buildEditPreviewAnimation(left, right)

		expect(firstChangedLine).toBe(10)
		expect(frames).toEqual([{ content: right, activeLine: 10, delayMs: 0, zip: true }])
	})

	it("renders immediately before cumulative full-document frames cross the retained-byte budget", () => {
		const wideTail = "x".repeat(20_000)
		const left = Array.from({ length: 30 }, (_, i) => `old ${i} ${wideTail}`).join("\n")
		const right = Array.from({ length: 30 }, (_, i) => `new ${i} ${wideTail}`).join("\n")

		const { frames, firstChangedLine } = buildEditPreviewAnimation(left, right)

		expect(firstChangedLine).toBe(0)
		expect(frames).toEqual([{ content: right, activeLine: 0, delayMs: 0, zip: true }])
	})

	it("handles new-file previews (empty left) and single-line contents", () => {
		const single = buildEditPreviewAnimation("", "hello")
		expect(single.frames).toHaveLength(1)
		expect(single.frames[0].content).toBe("hello")
		const { frames } = buildEditPreviewAnimation("", "a\nb\nc")
		expect(frames[frames.length - 1].content).toBe("a\nb\nc")
	})

	it("returns a single instant frame for identical content", () => {
		expect(buildEditPreviewAnimation("a\nb", "a\nb").frames).toHaveLength(1)
	})

	it("pauses at a pure deletion point and ends at the shrunken content", () => {
		const { frames } = buildEditPreviewAnimation("a\nb\nc\nd\ne", "a\ne")
		expect(frames.some((f) => !f.zip)).toBe(true) // the deletion point gets a typing pause
		expect(frames[frames.length - 1].content).toBe("a\ne")
	})

	it("zips through unchanged spans and slows through the change (mid-file edit)", () => {
		// 400-line file with a 30-line change in the middle: start at the top, zip to
		// the change, type through it, zip to the bottom.
		const original = Array.from({ length: 400 }, (_, i) => `line ${i}`)
		const modified = [...original]
		for (let i = 185; i < 215; i++) {
			modified[i] = `CHANGED ${i}`
		}
		const { frames, firstChangedLine } = buildEditPreviewAnimation(original.join("\n"), modified.join("\n"))

		expect(firstChangedLine).toBe(185)
		const typing = frames.filter((f) => !f.zip)
		const zipsBefore = frames.filter((f) => f.zip && f.activeLine < 185)
		const zipsAfter = frames.filter((f) => f.zip && f.activeLine >= 215)

		expect(typing).toHaveLength(30) // one typing frame per changed line
		expect(typing.every((f) => f.activeLine >= 185 && f.activeLine < 215)).toBe(true)
		expect(typing.every((f) => f.delayMs >= 45)).toBe(true)
		// Unchanged spans are motion (several small fast steps), not a couple of teleports…
		expect(zipsBefore.length).toBeGreaterThanOrEqual(5)
		expect(zipsAfter.length).toBeGreaterThanOrEqual(5)
		// …but their total time stays a fraction of the typing time.
		const zipTime = [...zipsBefore, ...zipsAfter].reduce((ms, f) => ms + f.delayMs, 0)
		const typeTime = typing.reduce((ms, f) => ms + f.delayMs, 0)
		expect(zipTime).toBeLessThan(typeTime)
		// The sweep is monotonic top → bottom and ends exactly at the final content.
		for (let i = 1; i < frames.length; i++) {
			expect(frames[i].activeLine).toBeGreaterThan(frames[i - 1].activeLine)
		}
		expect(frames[frames.length - 1].content).toBe(modified.join("\n"))
	})

	it("slows down separately at each hunk of a multi-hunk edit", () => {
		// Two 5-line changes with a 100-line unchanged gap: the gap must zip.
		const original = Array.from({ length: 300 }, (_, i) => `line ${i}`)
		const modified = [...original]
		for (let i = 50; i < 55; i++) {
			modified[i] = `FIRST ${i}`
		}
		for (let i = 155; i < 160; i++) {
			modified[i] = `SECOND ${i}`
		}
		const { frames, firstChangedLine } = buildEditPreviewAnimation(original.join("\n"), modified.join("\n"))

		expect(firstChangedLine).toBe(50)
		const typing = frames.filter((f) => !f.zip)
		expect(typing.filter((f) => f.activeLine >= 50 && f.activeLine < 55)).toHaveLength(5)
		expect(typing.filter((f) => f.activeLine >= 155 && f.activeLine < 160)).toHaveLength(5)
		// The gap between the hunks zips — no typing frames inside it.
		expect(typing.some((f) => f.activeLine >= 55 && f.activeLine < 155)).toBe(false)
		expect(frames.some((f) => f.zip && f.activeLine >= 55 && f.activeLine < 155)).toBe(true)
		// Short hunks still dwell perceptibly (~350ms per hunk).
		const firstHunkMs = typing.filter((f) => f.activeLine < 55).reduce((ms, f) => ms + f.delayMs, 0)
		expect(firstHunkMs).toBeGreaterThanOrEqual(300)
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

	it("still applies auto-approved edits when the preview fails to open, and closes the partial preview", async () => {
		previewTweak = (preview) => {
			preview.failOpen = true
		}
		await writeFile("a.ts", "old content")
		const input = { path: "a.ts", old_text: "old", new_text: "new" }

		const result = await coordinator.executeEditorTool(input, tempDir, makeContext("tc1"))
		expect(result).toBe("fallback editor result")
		// A failed open() may have partially opened a tab before throwing; it is closed
		// directly since the session was never registered for discardPreview to find.
		expect(previews[0].closed).toBe(1)
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

	it("shows a brief preview around auto-approved patches", async () => {
		await writeFile("patched.ts", "line one\nline two\n")
		const patch = ["*** Begin Patch", "*** Update File: patched.ts", "@@", "-line one", "+line ONE", "*** End Patch"].join(
			"\n",
		)

		const result = await coordinator.executeApplyPatchTool({ input: patch }, tempDir, makeContext("tc9"))

		expect(result).toBe("fallback apply_patch result")
		expect(fallbackApplyPatch).toHaveBeenCalledOnce()
		expect(previews).toHaveLength(1)
		expect(previews[0].opened).toMatchObject({
			absolutePath: path.join(tempDir, "patched.ts"),
			leftContent: "line one\nline two\n",
			rightContent: "line ONE\nline two\n",
		})
		expect(previews[0].closed).toBe(1)
	})

	it("applies auto-approved patches without a preview when background edit is enabled", async () => {
		backgroundEdit = true
		const result = await coordinator.executeApplyPatchTool(
			{ input: "*** Begin Patch\n*** End Patch" },
			tempDir,
			makeContext("tc9"),
		)

		expect(result).toBe("fallback apply_patch result")
		expect(fallbackApplyPatch).toHaveBeenCalledOnce()
		expect(previews).toHaveLength(0)
	})
})
