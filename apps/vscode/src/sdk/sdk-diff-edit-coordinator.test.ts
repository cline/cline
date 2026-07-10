import type { AgentToolContext, ApplyPatchExecutor, EditFileInput, EditorExecutor } from "@cline/core"
import { formatResponse } from "@core/prompts/responses"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest"
import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"
import { computeNewEditorContent, SdkDiffEditCoordinator } from "./sdk-diff-edit-coordinator"
import { SdkMessageCoordinator } from "./sdk-message-coordinator"
import { createTaskProxy } from "./task-proxy"

vi.mock("./webview-grpc-bridge", () => ({
	pushMessageToWebview: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@core/storage/disk", () => ({
	saveClineMessages: vi.fn().mockResolvedValue(undefined),
}))

type SaveResult = Awaited<ReturnType<DiffViewProvider["saveChanges"]>>

/**
 * Overrides the full public lifecycle so the base class's VS Code / HostProvider
 * internals never run; records calls for assertions. Reads originals from the real
 * filesystem (tests use a temp dir) so the coordinator's staleness logic is exercised.
 */
class FakeDiffViewProvider extends DiffViewProvider {
	opens: Array<{ path: string; displayPath?: string; editType?: string }> = []
	updates: Array<{ content: string; isFinal: boolean }> = []
	scrolls = 0
	reverts = 0
	saveQueue: SaveResult[] = []
	failOpen = false
	/** When set, every save reports a closed diff document (all-undefined result). */
	alwaysClosedSave = false

	override async open(relPath: string, options?: { displayPath?: string }): Promise<void> {
		if (this.failOpen) {
			throw new Error("fake open failure")
		}
		this.isEditing = true
		this.opens.push({ path: relPath, displayPath: options?.displayPath, editType: this.editType })
		this.originalContent = this.editType === "modify" ? await fs.readFile(relPath, "utf-8") : ""
	}

	override async update(accumulatedContent: string, isFinal: boolean): Promise<void> {
		this.updates.push({ content: accumulatedContent, isFinal })
	}

	override async scrollToFirstDiff(): Promise<void> {
		this.scrolls++
	}

	override async saveChanges(): Promise<SaveResult> {
		if (this.alwaysClosedSave) {
			return {
				newProblemsMessage: undefined,
				userEdits: undefined,
				autoFormattingEdits: undefined,
				finalContent: undefined,
			}
		}
		const result = this.saveQueue.shift()
		if (result) {
			return result
		}
		const lastUpdate = this.updates[this.updates.length - 1]
		return {
			newProblemsMessage: "",
			userEdits: undefined,
			autoFormattingEdits: undefined,
			finalContent: lastUpdate?.content ?? "",
		}
	}

	override async revertChanges(): Promise<void> {
		this.reverts++
		this.isEditing = false
	}

	override async reset(): Promise<void> {
		this.isEditing = false
	}

	// Abstract members — unreachable because every public entry point is overridden above.
	protected override async openDiffEditor(): Promise<void> {}
	protected override async scrollEditorToLine(_line: number): Promise<void> {}
	protected override async scrollAnimation(_startLine: number, _endLine: number): Promise<void> {}
	protected override async truncateDocument(_lineNumber: number): Promise<void> {}
	protected override async getDocumentLineCount(): Promise<number> {
		return 0
	}
	protected override async getDocumentText(): Promise<string | undefined> {
		return undefined
	}
	protected override async saveDocument(): Promise<boolean> {
		return true
	}
	protected override async closeAllDiffViews(): Promise<void> {}
	protected override async resetDiffView(): Promise<void> {}
	override async replaceText(
		_content: string,
		_rangeToReplace: { startLine: number; endLine: number },
		_currentLine: number | undefined,
	): Promise<void> {}
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

	// The error strings below are pinned to the SDK executor's literals
	// (sdk/packages/core/src/extensions/tools/executors/editor.ts) so a preview failure
	// delegated to the disk executor reproduces byte-identical model-facing errors.
	it("throws the SDK's exact error for text not found", () => {
		const input: EditFileInput = { path: filePath, old_text: "zzz", new_text: "x" }
		expect(() => computeNewEditorContent("a\nb", input, filePath, "modify")).toThrow(
			`No replacement performed: text not found in ${filePath}.`,
		)
	})

	it("throws the SDK's exact error for ambiguous text", () => {
		const input: EditFileInput = { path: filePath, old_text: "a", new_text: "x" }
		expect(() => computeNewEditorContent("a\na", input, filePath, "modify")).toThrow(
			`No replacement performed: multiple occurrences of text found in ${filePath}.`,
		)
	})

	it("throws the SDK's exact error for missing old_text", () => {
		const input: EditFileInput = { path: filePath, new_text: "x" }
		expect(() => computeNewEditorContent("a", input, filePath, "modify")).toThrow(
			"Parameter `old_text` is required when editing an existing file without `insert_line`",
		)
	})

	it("throws the SDK's exact error for an out-of-range insert_line", () => {
		const input: EditFileInput = { path: filePath, new_text: "x", insert_line: 5 }
		expect(() => computeNewEditorContent("a\nb", input, filePath, "modify")).toThrow(
			"Invalid insert_line: 5. insert_line must be a positive one-based boundary line in the range 1-3. Use 3 to append at EOF.",
		)
	})
})

describe("SdkDiffEditCoordinator", () => {
	let tempDir: string
	let providers: FakeDiffViewProvider[]
	let backgroundEdit: boolean
	let fallbackEditor: Mock<EditorExecutor>
	let fallbackApplyPatch: Mock<ApplyPatchExecutor>
	let coordinator: SdkDiffEditCoordinator
	let task: ReturnType<typeof createTaskProxy>

	let providerTweak: ((provider: FakeDiffViewProvider) => void) | undefined

	function makeCoordinator(
		overrides?: Partial<ConstructorParameters<typeof SdkDiffEditCoordinator>[0]>,
	): SdkDiffEditCoordinator {
		return new SdkDiffEditCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			getCwd: async () => tempDir,
			isBackgroundEditEnabled: () => backgroundEdit,
			createDiffViewProvider: () => {
				const provider = new FakeDiffViewProvider()
				providerTweak?.(provider)
				providers.push(provider)
				return provider
			},
			fallbackEditorExecutor: fallbackEditor,
			fallbackApplyPatchExecutor: fallbackApplyPatch,
			settleDelays: { autoApproveMs: 0, repaintMs: 0 },
			...overrides,
		})
	}

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "diff-edit-test-"))
		providers = []
		providerTweak = undefined
		backgroundEdit = false
		fallbackEditor = vi.fn<EditorExecutor>().mockResolvedValue("fallback editor result")
		fallbackApplyPatch = vi.fn<ApplyPatchExecutor>().mockResolvedValue("fallback apply_patch result")
		task = createTaskProxy("session-123", vi.fn(), vi.fn())
		coordinator = makeCoordinator()
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	async function run<T>(promise: Promise<T>): Promise<T> {
		return promise
	}

	async function writeFile(name: string, content: string): Promise<string> {
		const absolutePath = path.join(tempDir, name)
		await fs.writeFile(absolutePath, content)
		return absolutePath
	}

	it("opens a populated diff before approval for an existing-file edit", async () => {
		await writeFile("a.ts", "line1\nline2\n")
		await run(coordinator.openForApproval("tc1", "editor", { path: "a.ts", old_text: "line1", new_text: "changed" }))

		expect(providers).toHaveLength(1)
		const provider = providers[0]
		expect(provider.opens[0]).toMatchObject({ path: path.join(tempDir, "a.ts"), displayPath: "a.ts", editType: "modify" })
		expect(provider.updates).toEqual([{ content: "changed\nline2\n", isFinal: true }])
		expect(provider.scrolls).toBe(1)
	})

	it("marks new files as create and skips preview for insert into missing file", async () => {
		await run(coordinator.openForApproval("tc1", "editor", { path: "new.ts", new_text: "content" }))
		expect(providers[0].opens[0].editType).toBe("create")
		expect(providers[0].updates[0].content).toBe("content")

		await run(coordinator.openForApproval("tc2", "editor", { path: "missing.ts", new_text: "x", insert_line: 1 }))
		expect(providers).toHaveLength(1) // no second provider
	})

	it("does not open previews when background edit is enabled", async () => {
		backgroundEdit = true
		await writeFile("a.ts", "content")
		await run(coordinator.openForApproval("tc1", "editor", { path: "a.ts", old_text: "content", new_text: "x" }))
		expect(providers).toHaveLength(0)
	})

	it("never throws from openForApproval and cleans up on preview failure", async () => {
		await writeFile("a.ts", "content")
		// old_text won't match — computeNewEditorContent throws, preview is abandoned
		await run(coordinator.openForApproval("tc1", "editor", { path: "a.ts", old_text: "nope", new_text: "x" }))
		expect(providers[0].reverts + providers[0].opens.length).toBeGreaterThanOrEqual(1)

		// executor falls back to the disk executor, which reproduces the canonical error
		const input = { path: "a.ts", old_text: "nope", new_text: "x" }
		fallbackEditor.mockRejectedValueOnce(new Error("No replacement performed: text not found in a.ts."))
		await expect(run(coordinator.executeEditorTool(input, tempDir, makeContext("tc1")))).rejects.toThrow(
			"No replacement performed: text not found",
		)
	})

	it("saves through the pre-approval session and formats the result without user edits", async () => {
		await writeFile("a.ts", "old content")
		const input = { path: "a.ts", old_text: "old", new_text: "new" }
		await run(coordinator.openForApproval("tc1", "editor", input))

		const result = await run(coordinator.executeEditorTool(input, tempDir, makeContext("tc1")))

		expect(fallbackEditor).not.toHaveBeenCalled()
		expect(result).toBe(formatResponse.fileEditWithoutUserChanges("a.ts", undefined, "new content", ""))
	})

	it("reports user edits with a user_feedback_diff message and the user-changes format", async () => {
		await writeFile("a.ts", "old content")
		const input = { path: "a.ts", old_text: "old", new_text: "new" }
		await run(coordinator.openForApproval("tc1", "editor", input))
		providers[0].saveQueue.push({
			newProblemsMessage: "",
			userEdits: "@@ user edit @@",
			autoFormattingEdits: undefined,
			finalContent: "user content",
		})

		const result = await run(coordinator.executeEditorTool(input, tempDir, makeContext("tc1")))

		expect(result).toBe(formatResponse.fileEditWithUserChanges("a.ts", "@@ user edit @@", undefined, "user content", ""))
		const says = task.messageStateHandler.getClineMessages()
		expect(says).toHaveLength(1)
		expect(says[0]).toMatchObject({ type: "say", say: "user_feedback_diff" })
		expect(JSON.parse(says[0].text ?? "{}")).toEqual({ tool: "editedExistingFile", path: "a.ts", diff: "@@ user edit @@" })
	})

	it("opens the diff during execution for auto-approved edits and waits the settle delay", async () => {
		coordinator = makeCoordinator({ settleDelays: { autoApproveMs: 150, repaintMs: 0 } })
		await writeFile("a.ts", "old content")
		const input = { path: "a.ts", old_text: "old", new_text: "new" }

		let settled = false
		const promise = coordinator.executeEditorTool(input, tempDir, makeContext("tc1")).then((r) => {
			settled = true
			return r
		})
		// After the diff opens the executor sits in the diagnostics settle.
		await sleep(50)
		expect(providers).toHaveLength(1)
		expect(settled).toBe(false)

		const result = await promise
		expect(result).toBe(formatResponse.fileEditWithoutUserChanges("a.ts", undefined, "new content", ""))
		expect(fallbackEditor).not.toHaveBeenCalled()
	})

	it("aborts the auto-approve settle when the tool signal fires", async () => {
		coordinator = makeCoordinator({ settleDelays: { autoApproveMs: 10_000, repaintMs: 0 } })
		await writeFile("a.ts", "old content")
		const input = { path: "a.ts", old_text: "old", new_text: "new" }
		const controller = new AbortController()

		const promise = coordinator.executeEditorTool(input, tempDir, makeContext("tc1", controller.signal))
		promise.catch(() => {}) // avoid unhandled-rejection noise before the assertion attaches
		await sleep(50)
		controller.abort()
		// Attach the rejection assertion only after aborting: under `bun test`, an
		// eagerly-created `.rejects` expectation never observes the later rejection.
		await expect(promise).rejects.toThrow("aborted")
		expect(providers[0].reverts).toBe(1)
		expect(fallbackEditor).not.toHaveBeenCalled()
	})

	it("delegates to the disk executor when background edit is enabled", async () => {
		backgroundEdit = true
		await writeFile("a.ts", "old content")
		const input = { path: "a.ts", old_text: "old", new_text: "new" }

		const result = await run(coordinator.executeEditorTool(input, tempDir, makeContext("tc1")))

		expect(result).toBe("fallback editor result")
		expect(fallbackEditor).toHaveBeenCalledWith(input, tempDir, expect.objectContaining({ toolCallId: "tc1" }))
		expect(providers).toHaveLength(0)
	})

	it("reopens once when the diff document was closed before save", async () => {
		await writeFile("a.ts", "old content")
		const input = { path: "a.ts", old_text: "old", new_text: "new" }
		await run(coordinator.openForApproval("tc1", "editor", input))
		// First save finds the document closed (all-undefined result).
		providers[0].saveQueue.push({
			newProblemsMessage: undefined,
			userEdits: undefined,
			autoFormattingEdits: undefined,
			finalContent: undefined,
		})

		const result = await run(coordinator.executeEditorTool(input, tempDir, makeContext("tc1")))

		expect(providers).toHaveLength(2) // reopened with a fresh provider
		expect(result).toBe(formatResponse.fileEditWithoutUserChanges("a.ts", undefined, "new content", ""))
		expect(fallbackEditor).not.toHaveBeenCalled()
	})

	it("falls back to the disk executor when the reopened document is also unavailable", async () => {
		await writeFile("a.ts", "old content")
		const input = { path: "a.ts", old_text: "old", new_text: "new" }
		// Every provider (original and the reopen) reports a closed diff document.
		providerTweak = (provider) => {
			provider.alwaysClosedSave = true
		}
		await run(coordinator.openForApproval("tc1", "editor", input))

		const result = await run(coordinator.executeEditorTool(input, tempDir, makeContext("tc1")))

		expect(providers).toHaveLength(2) // original + one reopen attempt
		expect(result).toBe("fallback editor result")
		expect(fallbackEditor).toHaveBeenCalledOnce()
	})

	it("falls back to the disk executor when opening the diff fails", async () => {
		await writeFile("a.ts", "old content")
		const input = { path: "a.ts", old_text: "old", new_text: "new" }
		providerTweak = (provider) => {
			provider.failOpen = true
		}

		const result = await run(coordinator.executeEditorTool(input, tempDir, makeContext("tc1")))

		expect(result).toBe("fallback editor result")
	})

	it("reopens against current disk content when the file changed since the preview", async () => {
		await writeFile("a.ts", "alpha\nshared\n")
		const input = { path: "a.ts", old_text: "shared", new_text: "replaced" }
		await run(coordinator.openForApproval("tc1", "editor", input))
		expect(providers[0].updates[0].content).toBe("alpha\nreplaced\n")

		// An earlier edit in the same turn changed the file after the preview opened.
		await writeFile("a.ts", "beta\nshared\n")
		const result = await run(coordinator.executeEditorTool(input, tempDir, makeContext("tc1")))

		expect(providers).toHaveLength(2)
		expect(providers[1].updates[0].content).toBe("beta\nreplaced\n")
		expect(result).toBe(formatResponse.fileEditWithoutUserChanges("a.ts", undefined, "beta\nreplaced\n", ""))
	})

	it("reverts the preview on denial and revertAll cleans every session", async () => {
		await writeFile("a.ts", "old content")
		await writeFile("b.ts", "other content")
		await run(coordinator.openForApproval("tc1", "editor", { path: "a.ts", old_text: "old", new_text: "new" }))
		await run(coordinator.openForApproval("tc2", "editor", { path: "b.ts", old_text: "other", new_text: "new" }))

		await coordinator.revert("tc1")
		expect(providers[0].reverts).toBe(1)
		await coordinator.revert("tc1") // unknown/already-reverted id is a no-op
		expect(providers[0].reverts).toBe(1)

		await coordinator.revertAll("test cleanup")
		expect(providers[1].reverts).toBe(1)
	})

	it("previews the first file of an apply_patch and reverts it before the default executor runs", async () => {
		await writeFile("patched.ts", "line one\nline two\n")
		const patch = ["*** Begin Patch", "*** Update File: patched.ts", "@@", "-line one", "+line ONE", "*** End Patch"].join(
			"\n",
		)

		await run(coordinator.openForApproval("tc1", "apply_patch", { input: patch }))

		expect(providers).toHaveLength(1)
		expect(providers[0].opens[0]).toMatchObject({
			path: path.join(tempDir, "patched.ts"),
			displayPath: "patched.ts",
			editType: "modify",
		})
		expect(providers[0].updates[0]).toMatchObject({ content: "line ONE\nline two\n", isFinal: true })

		const callOrder: string[] = []
		fallbackApplyPatch.mockImplementation(async () => {
			callOrder.push("apply")
			return "patch applied"
		})
		const originalRevert = providers[0].revertChanges.bind(providers[0])
		providers[0].revertChanges = async () => {
			callOrder.push("revert")
			await originalRevert()
		}

		const result = await run(coordinator.executeApplyPatchTool({ input: patch }, tempDir, makeContext("tc1")))

		expect(result).toBe("patch applied")
		expect(callOrder).toEqual(["revert", "apply"])
	})

	it("applies patches without preview sessions directly", async () => {
		const result = await run(
			coordinator.executeApplyPatchTool({ input: "*** Begin Patch\n*** End Patch" }, tempDir, makeContext("tc9")),
		)
		expect(result).toBe("fallback apply_patch result")
		expect(fallbackApplyPatch).toHaveBeenCalledOnce()
	})
})
