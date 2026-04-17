import { strict as assert } from "node:assert"
import os from "node:os"
import path from "node:path"
import { describe, it } from "mocha"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import { PatchActionType } from "@/shared/Patch"
import { MAX_FILE_EDIT_DISPLAY_BYTES } from "../../utils/LargeEditGuards"
import { ApplyPatchHandler } from "../ApplyPatchHandler"

describe("ApplyPatchHandler large edit guards", () => {
	it("summarizes oversized patch input in approval payloads", async () => {
		let askedMessage = ""
		const handler = new ApplyPatchHandler({ checkClineIgnorePath: () => ({ ok: true }) } as any)
		const config = {
			ulid: "ulid-1",
			autoApprovalSettings: { enableNotifications: false },
			api: {
				getModel: () => ({ id: "test-model" }),
			},
			services: {
				stateManager: {
					getApiConfiguration: () => ({ planModeApiProvider: "openai", actModeApiProvider: "openai" }),
					getGlobalSettingsKey: () => "act",
				},
			},
			taskState: {
				userMessageContent: [],
				didRejectTool: false,
			},
			callbacks: {
				shouldAutoApproveToolWithPath: sinon.stub().resolves(false),
				removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
				ask: sinon.stub().callsFake(async (_kind: string, message: string) => {
					askedMessage = message
					return { response: "yesButtonClicked" }
				}),
				say: sinon.stub().resolves(),
			},
		} as any

		const oversizedPatch = `*** Begin Patch\n*** Add File: big.ts\n+${"x".repeat(MAX_FILE_EDIT_DISPLAY_BYTES + 1024)}\n*** End Patch`

		const approved = await (handler as any).handleApproval(
			config,
			{ name: "apply_patch", isNativeToolCall: false },
			{ tool: "newFileCreated", path: "big.ts", content: "placeholder" },
			oversizedPatch,
		)

		assert.equal(approved, true)
		assert.match(askedMessage, /omitted from tool payload/)
		assert.doesNotMatch(askedMessage, new RegExp(`x{${MAX_FILE_EDIT_DISPLAY_BYTES + 100}}`))
	})

	it("summarizes multiple oversized file changes in multi-file patch previews", async () => {
		const sandbox = sinon.createSandbox()
		const handler = new ApplyPatchHandler({ checkClineIgnorePath: () => ({ ok: true }) } as any)
		const hugeA = "a".repeat(MAX_FILE_EDIT_DISPLAY_BYTES + 512)
		const hugeB = "b".repeat(MAX_FILE_EDIT_DISPLAY_BYTES + 1024)
		sandbox.stub(HostProvider, "workspace").value({
			getWorkspacePaths: async () => ({ paths: [] }),
		})

		try {
			const summaries = await (handler as any).generateChangeSummary({
				"big-a.ts": {
					type: PatchActionType.ADD,
					newContent: hugeA,
				},
				"big-b.ts": {
					type: PatchActionType.UPDATE,
					oldContent: "before",
					newContent: hugeB,
				},
			})

			assert.equal(summaries.length, 2)
			assert.equal(summaries[0].path, "big-a.ts")
			assert.equal(summaries[1].path, "big-b.ts")
			assert.match(summaries[0].content || "", /omitted from tool payload/)
			assert.match(summaries[1].content || "", /omitted from tool payload/)
			assert.doesNotMatch(summaries[0].content || "", /a{1000}/)
			assert.doesNotMatch(summaries[1].content || "", /b{1000}/)
		} finally {
			sandbox.restore()
		}
	})

	it("applies a multi-file patch with oversized final content summaries", async () => {
		const sandbox = sinon.createSandbox()
		const handler = new ApplyPatchHandler({ checkClineIgnorePath: () => ({ ok: true }) } as any)
		const cwd = path.join(os.tmpdir(), `cline-apply-patch-${Date.now()}`)
		const hugeA = "a".repeat(MAX_FILE_EDIT_DISPLAY_BYTES + 512)
		const hugeB = "b".repeat(MAX_FILE_EDIT_DISPLAY_BYTES + 1024)

		sandbox.stub(HostProvider, "workspace").value({
			getWorkspacePaths: async () => ({ paths: [cwd] }),
		})

		const diffViewProvider = {
			isEditing: false,
			editType: undefined as string | undefined,
			originalContent: "",
			open: sandbox.stub().resolves(),
			update: sandbox.stub().resolves(),
			saveChanges: sandbox
				.stub()
				.onFirstCall()
				.resolves({ finalContent: hugeA })
				.onSecondCall()
				.resolves({ finalContent: hugeB }),
			revertChanges: sandbox.stub().resolves(),
			reset: sandbox.stub().resolves(),
			deleteFile: sandbox.stub().resolves(),
		}

		const config = {
			ulid: "ulid-1",
			cwd,
			api: {
				getModel: () => ({ id: "test-model" }),
			},
			autoApprovalSettings: { enableNotifications: false },
			services: {
				stateManager: {
					getApiConfiguration: () => ({ planModeApiProvider: "openai", actModeApiProvider: "openai" }),
					getGlobalSettingsKey: (key: string) => {
						if (key === "mode") return "act"
						if (key === "hooksEnabled") return false
						return undefined
					},
				},
				diffViewProvider,
				fileContextTracker: {
					markFileAsEditedByCline: sandbox.stub(),
					trackFileContext: sandbox.stub().resolves(),
				},
			},
			taskState: {
				userMessageContent: [],
				didRejectTool: false,
				fileReadCache: new Map<string, string>(),
				didEditFile: false,
				consecutiveMistakeCount: 0,
			},
			callbacks: {
				shouldAutoApproveToolWithPath: sandbox.stub().resolves(true),
				removeLastPartialMessageIfExistsWithType: sandbox.stub().resolves(),
				say: sandbox.stub().resolves(),
			},
		} as any

		const patchInput = [
			"*** Begin Patch",
			"*** Add File: big-a.ts",
			`+${hugeA}`,
			"*** Add File: big-b.ts",
			`+${hugeB}`,
			"*** End Patch",
		].join("\n")

		try {
			const result = await handler.execute(config, {
				type: "tool_use",
				name: "apply_patch",
				params: { input: patchInput },
				partial: false,
				isNativeToolCall: false,
			} as any)
			const resultText = typeof result === "string" ? result : JSON.stringify(result)

			assert.match(resultText, /Successfully applied patch to the following files:/)
			assert.match(resultText, /Final file content for 'big-a\.ts' omitted from tool payload/)
			assert.match(resultText, /Final file content for 'big-b\.ts' omitted from tool payload/)
			assert.doesNotMatch(resultText, /a{1000}/)
			assert.doesNotMatch(resultText, /b{1000}/)
			assert.equal(diffViewProvider.saveChanges.callCount, 2)
		} finally {
			sandbox.restore()
		}
	})
})
