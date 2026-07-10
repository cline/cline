/**
 * A read-only, virtual-document diff preview of a proposed file edit.
 *
 * Unlike {@link DiffViewProvider}, which streams into the *real* (editable) file
 * document, an EditPreview never touches the file on disk: both sides of the diff
 * are virtual documents, so opening it has no side effects, discarding it needs no
 * revert, and multiple previews of the same file can't interfere with each other.
 * The actual write happens elsewhere (the SDK's disk-writing tool executor) after
 * the preview is closed.
 *
 * One instance per preview; obtain instances via HostProvider.get().createEditPreview().
 */
export interface EditPreviewContent {
	/** Diff tab title, e.g. "utils.ts: Original ↔ Cline's Changes (Preview)". */
	title: string
	/** Absolute path of the file being edited. */
	absolutePath: string
	/** Workspace-relative (model-provided) path, used for tab labels. */
	displayPath: string
	/** Current file content ("" for new files). */
	leftContent: string
	/** Proposed file content. */
	rightContent: string
}

export abstract class EditPreview {
	/** Opens the diff preview. */
	abstract open(content: EditPreviewContent): Promise<void>

	/** Closes this preview's diff tab. Safe to call when nothing is open. */
	abstract close(): Promise<void>
}
