import {
	type ApplyPatchExecutor,
	type ApplyPatchInput,
	computePatchChanges,
	createApplyPatchExecutor,
	createEditorExecutor,
	type EditFileInput,
	type EditorExecutor,
	PatchActionType,
} from "@cline/core"
import type { AgentToolContext } from "@cline/shared"
import * as fs from "fs/promises"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import type { EditPreview } from "@/integrations/editor/EditPreview"
import { Logger } from "@/shared/services/Logger"

/**
 * How long an auto-approved edit's preview stays visible after the write, so the
 * user can watch the change land without stalling the agent loop for long.
 * Manually-approved edits don't need this: the preview is open while the user decides.
 */
const AUTO_APPROVE_PREVIEW_LINGER_MS = 1_500

export interface SdkDiffEditCoordinatorOptions {
	/** Workspace root used to resolve relative tool paths. */
	getCwd: () => Promise<string>
	/** When Background Edit is enabled, edits apply headlessly with no preview. */
	isBackgroundEditEnabled: () => boolean
	/** Injectable for tests. Defaults to the host-registered factory. */
	createEditPreview?: () => EditPreview
	/** Injectable for tests. Defaults to the SDK's disk-writing editor executor. */
	fallbackEditorExecutor?: EditorExecutor
	/** Injectable for tests. Defaults to the SDK's disk-writing apply_patch executor. */
	fallbackApplyPatchExecutor?: ApplyPatchExecutor
	/** Test seam: overrides the auto-approve preview linger. */
	autoApprovePreviewLingerMs?: number
}

interface DiffEditSession {
	/** Undefined once the preview has been displaced by a newer same-file preview. */
	preview: EditPreview | undefined
	absolutePath: string
}

/**
 * Shows a read-only diff preview of SDK edit-tool changes (editor / apply_patch).
 *
 * The preview is a virtual-document diff — both sides are virtual, the real file is
 * never opened or modified by the preview — so opening it has no side effects,
 * rejecting an edit only closes a tab, and multiple previews (even of the same file)
 * can't interfere with each other. The actual write is always the SDK's default
 * disk-writing executor, which the overridden executors delegate to after closing
 * the preview; its results and error strings reach the model unchanged.
 *
 * Previews open at approval time (the SDK surfaces tool input only after the model's
 * stream completes, so the approval callback is the only pre-execution point with
 * full input; streaming-during-generation is not possible). Auto-approved edits get
 * a brief preview during execution instead.
 */
export class SdkDiffEditCoordinator {
	private readonly sessions = new Map<string, DiffEditSession>()
	private readonly fallbackEditorExecutor: EditorExecutor
	private readonly fallbackApplyPatchExecutor: ApplyPatchExecutor
	private readonly autoApprovePreviewLingerMs: number

	constructor(private readonly options: SdkDiffEditCoordinatorOptions) {
		this.fallbackEditorExecutor = options.fallbackEditorExecutor ?? createEditorExecutor()
		this.fallbackApplyPatchExecutor = options.fallbackApplyPatchExecutor ?? createApplyPatchExecutor()
		this.autoApprovePreviewLingerMs = options.autoApprovePreviewLingerMs ?? AUTO_APPROVE_PREVIEW_LINGER_MS
	}

	/**
	 * Opens the diff preview for an edit tool BEFORE its approval ask is shown, so the
	 * user decides while looking at the actual change. Never throws; on any failure the
	 * approval flow proceeds without a preview and the executor still applies the edit.
	 */
	async openForApproval(toolCallId: string, toolName: string, input: unknown): Promise<void> {
		if (this.options.isBackgroundEditEnabled() || this.sessions.has(toolCallId)) {
			return
		}
		try {
			if (toolName === "editor") {
				await this.openEditorPreview(toolCallId, input as EditFileInput)
			} else if (toolName === "apply_patch") {
				await this.openPatchPreview(toolCallId, input as ApplyPatchInput)
			}
		} catch (error) {
			Logger.warn(`[SdkDiffEditCoordinator] Failed to open diff preview for ${toolName}: ${error}`)
			await this.discardPreview(toolCallId)
		}
	}

	/**
	 * The `editor` tool executor override: delegate the write to the SDK's disk executor,
	 * with the preview visible around it. Auto-approved edits (no pre-approval preview)
	 * get a brief preview that lingers shortly after the write so the user sees it land.
	 */
	async executeEditorTool(input: EditFileInput, cwd: string, context: AgentToolContext): Promise<string> {
		const toolCallId = context.toolCallId ?? ""
		const hadPreApprovalPreview = this.sessions.has(toolCallId)
		try {
			if (!hadPreApprovalPreview && !this.options.isBackgroundEditEnabled()) {
				// Auto-approved (or hook-approved) edit: no preview was opened at approval
				// time, so show one now. Best-effort — never blocks the edit.
				try {
					await this.openEditorPreview(toolCallId, input)
				} catch (error) {
					Logger.warn(`[SdkDiffEditCoordinator] Failed to show auto-approve preview: ${error}`)
				}
			}
			const result = await this.fallbackEditorExecutor(input, cwd, context)
			if (!hadPreApprovalPreview && this.sessions.get(toolCallId)?.preview) {
				// Keep the auto-approve preview visible briefly after the write; an abort
				// just cuts the linger short (the edit has already been applied).
				await lingerDelay(this.autoApprovePreviewLingerMs, context.signal)
			}
			return result
		} finally {
			await this.discardPreview(toolCallId)
		}
	}

	/**
	 * The `apply_patch` tool executor override: close the preview, then delegate the
	 * whole patch application to the SDK's default executor.
	 */
	async executeApplyPatchTool(input: ApplyPatchInput, cwd: string, context: AgentToolContext): Promise<string> {
		await this.discardPreview(context.toolCallId ?? "")
		return this.fallbackApplyPatchExecutor(input, cwd, context)
	}

	/** Closes one preview (reject / abort / edit applied). Never throws; unknown ids are a no-op. */
	async discardPreview(toolCallId: string): Promise<void> {
		const session = this.sessions.get(toolCallId)
		this.sessions.delete(toolCallId)
		if (!session?.preview) {
			return
		}
		try {
			await session.preview.close()
		} catch (error) {
			Logger.warn(`[SdkDiffEditCoordinator] Failed to close diff preview: ${error}`)
		}
	}

	/** Closes every open preview. Called on turn end, task end, and controller dispose. */
	async discardAllPreviews(reason: string): Promise<void> {
		if (this.sessions.size === 0) {
			return
		}
		Logger.log(`[SdkDiffEditCoordinator] Closing ${this.sessions.size} diff preview(s): ${reason}`)
		for (const toolCallId of [...this.sessions.keys()]) {
			await this.discardPreview(toolCallId)
		}
	}

	private async openEditorPreview(toolCallId: string, input: EditFileInput): Promise<void> {
		if (typeof input?.path !== "string" || input.path.length === 0 || typeof input.new_text !== "string") {
			throw new Error("editor input missing path or new_text")
		}
		const cwd = await this.options.getCwd()
		const absolutePath = resolveEditPath(cwd, input.path)
		let originalContent: string | undefined
		try {
			originalContent = await fs.readFile(absolutePath, "utf-8")
		} catch {
			originalContent = undefined
		}
		if (input.insert_line != null && originalContent === undefined) {
			// The SDK's insert path requires an existing file; skip the preview and let
			// the executor produce its canonical error.
			throw new Error(`cannot insert into missing file ${absolutePath}`)
		}
		const editType = originalContent === undefined ? "create" : "modify"
		const newContent = computeNewEditorContent(originalContent ?? "", input, absolutePath, editType)

		await this.openPreview(toolCallId, {
			absolutePath,
			displayPath: input.path,
			editType,
			leftContent: originalContent ?? "",
			rightContent: newContent,
		})
	}

	private async openPatchPreview(toolCallId: string, input: ApplyPatchInput): Promise<void> {
		if (typeof input?.input !== "string" || input.input.length === 0) {
			return
		}
		const cwd = await this.options.getCwd()
		const { changes } = await computePatchChanges(input.input, cwd)
		// Preview the first file the patch creates or updates. Multi-file patches are
		// uncommon; any remaining files apply without a preview.
		const first = Object.entries(changes).find(
			([, change]) =>
				(change.type === PatchActionType.ADD || change.type === PatchActionType.UPDATE) &&
				change.newContent !== undefined,
		)
		if (!first) {
			return
		}
		const [filePath, change] = first
		await this.openPreview(toolCallId, {
			absolutePath: resolveEditPath(cwd, filePath),
			displayPath: filePath,
			editType: change.type === PatchActionType.ADD ? "create" : "modify",
			leftContent: change.oldContent ?? "",
			rightContent: change.newContent ?? "",
		})
	}

	private async openPreview(
		toolCallId: string,
		content: {
			absolutePath: string
			displayPath: string
			editType: "create" | "modify"
			leftContent: string
			rightContent: string
		},
	): Promise<void> {
		// A newer preview for the same file supersedes an older pending one (approvals
		// resolve sequentially, so the older edit is already decided — its executor only
		// needs the session entry, not the tab).
		for (const [id, session] of this.sessions) {
			if (session.preview && session.absolutePath === content.absolutePath) {
				try {
					await session.preview.close()
				} catch (error) {
					Logger.warn(`[SdkDiffEditCoordinator] Failed to close superseded preview: ${error}`)
				}
				session.preview = undefined
				Logger.log(`[SdkDiffEditCoordinator] Superseded pending preview ${id} for ${content.displayPath}`)
			}
		}

		const preview = this.createPreview()
		const fileName = path.basename(content.absolutePath)
		const title =
			content.editType === "create"
				? `${fileName}: New File (Preview)`
				: `${fileName}: Original ↔ Cline's Changes (Preview)`
		try {
			await preview.open({
				title,
				absolutePath: content.absolutePath,
				displayPath: content.displayPath,
				leftContent: content.leftContent,
				rightContent: content.rightContent,
			})
		} catch (error) {
			// open() can fail after partially opening (the session isn't registered yet,
			// so discardPreview couldn't reach it) — close directly to avoid an orphaned tab.
			await preview.close().catch(() => {})
			throw error
		}
		this.sessions.set(toolCallId, { preview, absolutePath: content.absolutePath })
	}

	private createPreview(): EditPreview {
		return this.options.createEditPreview?.() ?? HostProvider.get().createEditPreview()
	}
}

/**
 * Computes the full proposed file content for an `editor` tool input, mirroring the
 * SDK executor's semantics (sdk/packages/core/src/extensions/tools/executors/editor.ts)
 * so the preview shows exactly what the executor will write. Inputs the SDK would
 * reject throw here too, and the preview is simply skipped.
 */
export function computeNewEditorContent(
	originalContent: string,
	input: EditFileInput,
	filePath: string,
	editType: "create" | "modify",
): string {
	if (input.insert_line != null) {
		const lines = originalContent.split("\n")
		const maxBoundaryLine = lines.length + 1
		if (input.insert_line < 1 || input.insert_line > maxBoundaryLine) {
			throw new Error(
				`Invalid insert_line: ${input.insert_line}. insert_line must be a positive one-based boundary line in the range 1-${maxBoundaryLine}. Use ${maxBoundaryLine} to append at EOF.`,
			)
		}
		lines.splice(input.insert_line - 1, 0, ...input.new_text.split("\n"))
		return lines.join("\n")
	}

	if (editType === "create") {
		return input.new_text
	}

	if (input.old_text == null) {
		throw new Error("Parameter `old_text` is required when editing an existing file without `insert_line`")
	}

	const occurrences = input.old_text.length === 0 ? 0 : originalContent.split(input.old_text).length - 1
	if (occurrences === 0) {
		throw new Error(`No replacement performed: text not found in ${filePath}.`)
	}
	if (occurrences > 1) {
		throw new Error(`No replacement performed: multiple occurrences of text found in ${filePath}.`)
	}
	return originalContent.replace(input.old_text, input.new_text ?? "")
}

/** Mirrors the SDK executor's resolveFilePath (restrictToCwd=true): absolute paths pass through. */
function resolveEditPath(cwd: string, inputPath: string): string {
	const isAbsoluteInput = path.isAbsolute(inputPath)
	const resolved = isAbsoluteInput ? path.normalize(inputPath) : path.resolve(cwd, inputPath)
	if (isAbsoluteInput) {
		return resolved
	}
	const rel = path.relative(cwd, resolved)
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		throw new Error(`Path must stay within cwd: ${inputPath}`)
	}
	return resolved
}

/** Waits `ms`, resolving early (never rejecting) if the signal aborts. */
function lingerDelay(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) {
		return Promise.resolve()
	}
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort)
			resolve()
		}, ms)
		const onAbort = () => {
			clearTimeout(timer)
			resolve()
		}
		signal?.addEventListener("abort", onAbort, { once: true })
	})
}
