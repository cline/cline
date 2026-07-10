import { diffLines } from "diff"

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
	/**
	 * Opens the diff preview. Implementations may animate the right side in
	 * (simulated streaming); the returned promise resolves once the preview is
	 * visible, not when any animation finishes.
	 */
	abstract open(content: EditPreviewContent): Promise<void>

	/** Closes this preview's diff tab (cancelling any running animation). Safe to call when nothing is open. */
	abstract close(): Promise<void>
}

export interface EditPreviewFrame {
	/** Full right-side content at this step of the sweep. */
	content: string
	/** 0-based line the sweep cursor is on, for decorations/scrolling. */
	activeLine: number
	/** How long to hold this frame. */
	delayMs: number
	/** True while zipping through unchanged lines; false while typing through a change. */
	zip: boolean
}

export interface EditPreviewAnimation {
	/**
	 * The sweep, top of file to bottom (legacy diff-view feel): the new content
	 * replaces the original line by line, zipping fast through unchanged spans and
	 * slowing down through each changed run. The last frame is always exactly the
	 * final content. A single-frame result means "nothing to animate".
	 */
	frames: EditPreviewFrame[]
	/** 0-based first changed line in the new content, for the post-animation reveal. */
	firstChangedLine: number
}

/** Zip pacing: fast, small steps so unchanged spans read as motion, not teleports. */
const ZIP_FRAME_MS = 16
const ZIP_LINES_PER_FRAME = 8
const ZIP_MAX_FRAMES_PER_SPAN = 18
/** Typing pacing: one changed line per frame, with a minimum dwell so even a one-line change visibly pauses. */
const TYPE_FRAME_MS = 45
const TYPE_MIN_RUN_MS = 350
const TYPE_MAX_FRAMES_PER_RUN = 35

/**
 * Builds the simulated streaming animation for an edit preview. The sweep covers the
 * whole file like the legacy diff view did, but pacing is diff-aware per run: start
 * at the top, zip to the first change, slow down through it, zip to the next change,
 * … then zip to the bottom. Changed runs come from a real line diff, so multi-hunk
 * edits get a slowdown at each hunk and the gaps between hunks zip.
 */
export function buildEditPreviewAnimation(leftContent: string, rightContent: string): EditPreviewAnimation {
	const newLines = rightContent.split("\n")
	const originalLines = leftContent.split("\n")
	const changed = changedNewLineFlags(leftContent, rightContent, newLines.length)
	const firstChangedLine = Math.max(0, changed.indexOf(true))

	if (!changed.includes(true)) {
		return { frames: [{ content: rightContent, activeLine: 0, delayMs: 0, zip: true }], firstChangedLine: 0 }
	}

	// Walk the file as alternating unchanged/changed runs, emitting sweep stops with
	// per-run stride and delay.
	const frames: EditPreviewFrame[] = []
	let index = 0
	while (index < newLines.length) {
		const isChanged = changed[index]
		let runEnd = index
		while (runEnd < newLines.length && changed[runEnd] === isChanged) {
			runEnd++
		}
		const runLength = runEnd - index

		let stride: number
		let delayMs: number
		if (isChanged) {
			const runFrames = Math.min(runLength, TYPE_MAX_FRAMES_PER_RUN)
			stride = Math.ceil(runLength / runFrames)
			delayMs = Math.max(TYPE_FRAME_MS, Math.round(TYPE_MIN_RUN_MS / runFrames))
		} else {
			const runFrames = Math.min(Math.ceil(runLength / ZIP_LINES_PER_FRAME), ZIP_MAX_FRAMES_PER_SPAN)
			stride = Math.ceil(runLength / runFrames)
			delayMs = ZIP_FRAME_MS
		}

		for (let line = Math.min(index + stride - 1, runEnd - 1); line < runEnd; line += stride) {
			frames.push({
				content: [...newLines.slice(0, line + 1), ...originalLines.slice(line + 1)].join("\n"),
				activeLine: line,
				delayMs,
				zip: !isChanged,
			})
		}
		if (frames[frames.length - 1].activeLine !== runEnd - 1) {
			frames.push({
				content: [...newLines.slice(0, runEnd), ...originalLines.slice(runEnd)].join("\n"),
				activeLine: runEnd - 1,
				delayMs,
				zip: !isChanged,
			})
		}
		index = runEnd
	}

	// The sweep's final stop must be exactly the final content (line counts can differ).
	const last = frames[frames.length - 1]
	frames[frames.length - 1] = { ...last, content: rightContent }
	return { frames, firstChangedLine }
}

/**
 * Marks which lines of the NEW content belong to a changed run, via a real line
 * diff so multi-hunk edits produce multiple distinct runs (each hunk slows the
 * sweep; the unchanged gaps between hunks zip). A pure deletion marks the line at
 * the deletion point so the sweep pauses where content disappeared.
 */
function changedNewLineFlags(leftContent: string, rightContent: string, newLineCount: number): boolean[] {
	const flags: boolean[] = new Array(newLineCount).fill(false)
	let index = 0
	for (const part of diffLines(leftContent, rightContent)) {
		const count = part.count ?? 0
		if (part.added) {
			for (let i = 0; i < count && index + i < newLineCount; i++) {
				flags[index + i] = true
			}
			index += count
		} else if (part.removed) {
			if (index < newLineCount) {
				flags[index] = true
			}
		} else {
			index += count
		}
	}
	return flags
}
