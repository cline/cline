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
import { formatResponse } from "@core/prompts/responses"
import * as fs from "fs/promises"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import type { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"
import type { ClineMessage, ClineSayTool } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { MessageIdMinter } from "./message-id-minter"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"

/**
 * Delay after an auto-approved edit is rendered in the diff editor before saving,
 * giving the language servers time to analyze the new (unsaved) buffer so
 * saveChanges() can report new problems. Mirrors the legacy WriteToFileToolHandler
 * behavior; for manually-approved edits the user's decision time serves this purpose.
 */
const AUTO_APPROVE_DIAGNOSTICS_SETTLE_MS = 3_500

/** Delay after the final diff-view update before scrolling, letting the editor repaint (legacy parity). */
const DIFF_VIEW_SETTLE_MS = 300

export interface SdkDiffEditCoordinatorOptions {
	messages: SdkMessageCoordinator
	getSessionId: () => string
	postStateToWebview: () => Promise<void>
	/** Workspace root used to resolve relative tool paths at approval time. */
	getCwd: () => Promise<string>
	/** When Background Edit is enabled, edits apply headlessly via the SDK's default executors. */
	isBackgroundEditEnabled: () => boolean
	/** Shared id/seq/epoch authority (see SdkInteractionCoordinator). Optional for tests. */
	getMinter?: () => MessageIdMinter
	/** Injectable for tests. Defaults to the host-registered factory. */
	createDiffViewProvider?: () => DiffViewProvider
	/** Injectable for tests. Defaults to the SDK's disk-writing editor executor. */
	fallbackEditorExecutor?: EditorExecutor
	/** Injectable for tests. Defaults to the SDK's disk-writing apply_patch executor. */
	fallbackApplyPatchExecutor?: ApplyPatchExecutor
	/** Test seam: overrides the auto-approve diagnostics settle and post-update repaint delays. */
	settleDelays?: { autoApproveMs?: number; repaintMs?: number }
}

interface DiffEditSession {
	provider: DiffViewProvider
	editType: "create" | "modify"
	absolutePath: string
	/** The path as the model provided it, used for UI rows and model-facing results. */
	displayPath: string
	newContent: string
	/** True when the diff was opened before approval (the user's decision time doubled as the diagnostics settle). */
	openedPreApproval: boolean
	/**
	 * apply_patch sessions are preview-only: the diff shows the patch's first file change,
	 * but on approve the preview is reverted and the SDK's default executor applies the
	 * whole patch. User edits typed into a preview-only pane are NOT preserved.
	 */
	previewOnly: boolean
}

/**
 * Restores the legacy editor diff view for SDK edit tools.
 *
 * Owns one DiffViewProvider-backed session per toolCallId. The diff opens populated
 * at approval time (the SDK surfaces tool input only after the model's stream
 * completes, so streaming-during-generation is not possible), the user can review
 * and amend the proposed content, and the overridden `editor` executor saves through
 * the diff document so user edits and post-save auto-formatting flow back to the model.
 *
 * Any failure in the diff pipeline reverts the visual session and delegates to the
 * SDK's default disk-writing executor, so edits degrade to today's headless behavior
 * rather than breaking, and model-fault errors (old_text not found/ambiguous, bad
 * insert_line) keep their canonical SDK error strings.
 */
export class SdkDiffEditCoordinator {
	private readonly sessions = new Map<string, DiffEditSession>()
	/** Serializes visual applies so concurrent edit tool calls can't interleave diff-editor operations. */
	private applyMutex: Promise<unknown> = Promise.resolve()
	private readonly fallbackEditorExecutor: EditorExecutor
	private readonly fallbackApplyPatchExecutor: ApplyPatchExecutor
	private readonly autoApproveSettleMs: number
	private readonly repaintSettleMs: number

	constructor(private readonly options: SdkDiffEditCoordinatorOptions) {
		this.fallbackEditorExecutor = options.fallbackEditorExecutor ?? createEditorExecutor()
		this.fallbackApplyPatchExecutor = options.fallbackApplyPatchExecutor ?? createApplyPatchExecutor()
		this.autoApproveSettleMs = options.settleDelays?.autoApproveMs ?? AUTO_APPROVE_DIAGNOSTICS_SETTLE_MS
		this.repaintSettleMs = options.settleDelays?.repaintMs ?? DIFF_VIEW_SETTLE_MS
	}

	/**
	 * Opens the diff editor for an edit tool BEFORE its approval ask is shown, so the
	 * user decides while looking at the actual change. Never throws; on any failure the
	 * approval flow proceeds without a visual preview and the executor path recovers.
	 */
	async openForApproval(toolCallId: string, toolName: string, input: unknown): Promise<void> {
		if (this.options.isBackgroundEditEnabled() || this.sessions.has(toolCallId)) {
			return
		}
		try {
			if (toolName === "editor") {
				await this.openEditorPreview(toolCallId, input as EditFileInput, /* openedPreApproval */ true)
			} else if (toolName === "apply_patch") {
				await this.openPatchPreview(toolCallId, input as ApplyPatchInput)
			}
		} catch (error) {
			Logger.warn(`[SdkDiffEditCoordinator] Failed to open diff preview for ${toolName}: ${error}`)
			await this.revert(toolCallId)
		}
	}

	/**
	 * The `editor` tool executor override. Saves through the open diff session when one
	 * exists (or opens one now for auto-approved edits), and falls back to the SDK's
	 * default disk executor whenever the visual pipeline can't complete.
	 */
	async executeEditorTool(input: EditFileInput, cwd: string, context: AgentToolContext): Promise<string> {
		return this.runExclusive(async () => {
			const toolCallId = context.toolCallId ?? ""
			if (this.options.isBackgroundEditEnabled() && !this.sessions.has(toolCallId)) {
				return this.fallbackEditorExecutor(input, cwd, context)
			}

			let session = this.sessions.get(toolCallId)
			try {
				if (!session) {
					// Auto-approved (or hook-approved) edit: no preview was opened at approval
					// time, so open the populated diff now and let the user watch it land.
					session = await this.openEditorPreview(toolCallId, input, /* openedPreApproval */ false)
				} else {
					session = await this.refreshSessionIfStale(toolCallId, session, input)
				}

				if (!session.openedPreApproval) {
					await abortableDelay(this.autoApproveSettleMs, context.signal)
				}

				let result = await session.provider.saveChanges()
				if (result.finalContent === undefined) {
					// The diff document was closed under us (a sibling edit's save closes all
					// cline-diff tabs, or the user closed the tab). Reopen once and retry.
					Logger.log("[SdkDiffEditCoordinator] Diff document closed before save; reopening and retrying once")
					await session.provider.reset()
					this.sessions.delete(toolCallId)
					session = await this.openEditorPreview(toolCallId, input, session.openedPreApproval)
					result = await session.provider.saveChanges()
				}
				if (result.finalContent === undefined) {
					throw new Error("diff document unavailable after reopen")
				}

				if (result.userEdits) {
					this.sayUserFeedbackDiff(session, result.userEdits)
					return formatResponse.fileEditWithUserChanges(
						session.displayPath,
						result.userEdits,
						result.autoFormattingEdits,
						result.finalContent,
						result.newProblemsMessage,
					)
				}
				return formatResponse.fileEditWithoutUserChanges(
					session.displayPath,
					result.autoFormattingEdits,
					result.finalContent,
					result.newProblemsMessage,
				)
			} catch (error) {
				// Revert any visual state, then delegate to the SDK's disk executor: infra
				// failures still apply the edit, and model-fault failures (old_text not
				// found/ambiguous, bad insert_line) reproduce their canonical error strings.
				if (isAbortError(error)) {
					await this.revert(toolCallId)
					throw error
				}
				Logger.warn(`[SdkDiffEditCoordinator] Diff edit pipeline failed, falling back to disk executor: ${error}`)
				await this.revert(toolCallId)
				return this.fallbackEditorExecutor(input, cwd, context)
			} finally {
				this.sessions.delete(toolCallId)
			}
		})
	}

	/**
	 * The `apply_patch` tool executor override. The preview (if one was opened at
	 * approval time) is strictly visual: revert it first so the default executor's
	 * disk writes cannot be clobbered by a later document save, then apply the whole
	 * patch with the SDK's untouched implementation.
	 */
	async executeApplyPatchTool(input: ApplyPatchInput, cwd: string, context: AgentToolContext): Promise<string> {
		return this.runExclusive(async () => {
			const toolCallId = context.toolCallId ?? ""
			if (this.sessions.has(toolCallId)) {
				await this.revert(toolCallId)
			}
			return this.fallbackApplyPatchExecutor(input, cwd, context)
		})
	}

	/** Reverts one session (reject / abort / cleanup). Never throws; no-op for unknown ids. */
	async revert(toolCallId: string): Promise<void> {
		const session = this.sessions.get(toolCallId)
		this.sessions.delete(toolCallId)
		if (!session) {
			return
		}
		try {
			await session.provider.revertChanges()
		} catch (error) {
			Logger.warn(`[SdkDiffEditCoordinator] Failed to revert diff edit session: ${error}`)
			try {
				await session.provider.reset()
			} catch {
				// best effort
			}
		}
	}

	/** Reverts every open session. Called on turn end, task end, and controller dispose. */
	async revertAll(reason: string): Promise<void> {
		if (this.sessions.size === 0) {
			return
		}
		Logger.log(`[SdkDiffEditCoordinator] Reverting ${this.sessions.size} diff edit session(s): ${reason}`)
		const ids = [...this.sessions.keys()]
		for (const toolCallId of ids) {
			await this.revert(toolCallId)
		}
	}

	private async openEditorPreview(
		toolCallId: string,
		input: EditFileInput,
		openedPreApproval: boolean,
	): Promise<DiffEditSession> {
		if (typeof input?.path !== "string" || input.path.length === 0 || typeof input.new_text !== "string") {
			throw new Error("editor input missing path or new_text")
		}
		const cwd = await this.options.getCwd()
		const absolutePath = resolveEditPath(cwd, input.path)
		const exists = await fileExists(absolutePath)
		if (input.insert_line != null && !exists) {
			// The SDK's insert path reads the file first; let the fallback produce its canonical error.
			throw new Error(`cannot insert into missing file ${absolutePath}`)
		}
		const editType = exists ? "modify" : "create"

		const provider = this.createProvider()
		provider.editType = editType
		await provider.open(absolutePath, { displayPath: input.path })
		const newContent = computeNewEditorContent(provider.originalContent ?? "", input, absolutePath, editType)
		await provider.update(newContent, true)
		await delay(this.repaintSettleMs)
		await provider.scrollToFirstDiff()

		const session: DiffEditSession = {
			provider,
			editType,
			absolutePath,
			displayPath: input.path,
			newContent,
			openedPreApproval,
			previewOnly: false,
		}
		this.sessions.set(toolCallId, session)
		return session
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
		const absolutePath = resolveEditPath(cwd, filePath)
		const editType = change.type === PatchActionType.ADD ? "create" : "modify"

		const provider = this.createProvider()
		provider.editType = editType
		await provider.open(absolutePath, { displayPath: filePath })
		await provider.update(change.newContent ?? "", true)
		await delay(this.repaintSettleMs)
		await provider.scrollToFirstDiff()

		this.sessions.set(toolCallId, {
			provider,
			editType,
			absolutePath,
			displayPath: filePath,
			newContent: change.newContent ?? "",
			openedPreApproval: true,
			previewOnly: true,
		})
	}

	/**
	 * A pre-approval session's proposed content was computed against the disk state at
	 * approval time. If the file changed since (e.g. an earlier edit in the same turn
	 * saved), reopen against the current content so we never clobber newer disk state.
	 */
	private async refreshSessionIfStale(
		toolCallId: string,
		session: DiffEditSession,
		input: EditFileInput,
	): Promise<DiffEditSession> {
		if (session.editType === "create") {
			// open() created the placeholder file, so an exists-check can't detect staleness;
			// a same-turn create+modify of one path lands in the modify branch below instead.
			return session
		}
		let currentContent: string
		try {
			currentContent = await fs.readFile(session.absolutePath, "utf-8")
		} catch {
			currentContent = ""
		}
		// Encoding differences can produce false positives here; the cost is a benign reopen.
		if (currentContent === session.provider.originalContent) {
			return session
		}
		Logger.log("[SdkDiffEditCoordinator] File changed since approval preview; reopening diff against current content")
		await session.provider.reset()
		this.sessions.delete(toolCallId)
		return this.openEditorPreview(toolCallId, input, session.openedPreApproval)
	}

	private createProvider(): DiffViewProvider {
		return this.options.createDiffViewProvider?.() ?? HostProvider.get().createDiffViewProvider()
	}

	private sayUserFeedbackDiff(session: DiffEditSession, userEdits: string): void {
		const sayTool: ClineSayTool = {
			tool: session.editType === "create" ? "newFileCreated" : "editedExistingFile",
			path: session.displayPath,
			diff: userEdits,
		}
		const message: ClineMessage = {
			ts: this.nextMessageTs(),
			type: "say",
			say: "user_feedback_diff",
			text: JSON.stringify(sayTool),
			partial: false,
		}
		this.options.messages.appendAndEmit([message], {
			type: "status",
			payload: { sessionId: this.options.getSessionId(), status: "running" },
		})
		this.options.postStateToWebview().catch(() => {})
	}

	private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.applyMutex.then(fn, fn)
		this.applyMutex = run.catch(() => {})
		return run
	}

	private fallbackMinter: MessageIdMinter | undefined
	private nextMessageTs(): number {
		if (this.options.getMinter) {
			return this.options.getMinter().nextId()
		}
		if (!this.fallbackMinter) {
			this.fallbackMinter = new MessageIdMinter()
		}
		return this.fallbackMinter.nextId()
	}
}

/**
 * Computes the full proposed file content for an `editor` tool input, mirroring the
 * SDK executor's semantics exactly — including its error messages — so a preview
 * failure delegated to the disk executor produces byte-identical model-facing errors.
 * See sdk/packages/core/src/extensions/tools/executors/editor.ts.
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

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
	if (!signal) {
		return delay(ms)
	}
	if (signal.aborted) {
		return Promise.reject(makeAbortError())
	}
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort)
			resolve()
		}, ms)
		const onAbort = () => {
			clearTimeout(timer)
			reject(makeAbortError())
		}
		signal.addEventListener("abort", onAbort, { once: true })
	})
}

function makeAbortError(): Error {
	const error = new Error("The operation was aborted")
	error.name = "AbortError"
	return error
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError"
}
