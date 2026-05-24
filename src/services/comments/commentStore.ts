/**
 * Comment store — persists user comments (from Edit Mode) to disk.
 *
 * Storage: ~/.aihydro/comments/<module_id>.json
 *
 * Each comment has:
 *   - A text anchor (Hypothesis-style: quote + position + range) so the host
 *     can re-attach it when the module is reopened or edited.
 *   - A status (open | addressed | orphaned) so resolved comments don't vanish.
 *   - The agent-proposed diff (if any) after `preview_address_comment` was called.
 *
 * The comment lifecycle is:
 *   open → (agent proposes diff) → awaiting_review → (user accepts) → addressed
 *   open → (anchor becomes invalid after edits) → orphaned
 *
 * Comments are emitted as PreviewEvents (kind='user.comment') so the agent can
 * observe them via `preview_recent_events`.
 */

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

const COMMENTS_DIR = path.join(os.homedir(), ".aihydro", "comments")

export type CommentStatus = "open" | "awaiting_review" | "addressed" | "orphaned"

/**
 * Hypothesis-style text anchor.  Three strategies from least to most fragile:
 *   1. Quote  — exact selected text (primary)
 *   2. Context — surrounding sentence for fuzzy re-matching
 *   3. Position — character offset as last resort (most fragile)
 */
export interface TextAnchor {
	/** The exact selected text */
	quote: string
	/** A wider context window (~200 chars) centred on the selection */
	context: string
	/** Character offset of the selection start in the document text */
	startOffset: number
	/** Character offset of the selection end */
	endOffset: number
	/** The CSS selector of the nearest ancestor with an id or class */
	parentSelector?: string
}

export interface Comment {
	id: string
	moduleId: string
	/** User's comment text */
	body: string
	anchor: TextAnchor
	status: CommentStatus
	/** ISO timestamp when the comment was created */
	createdAt: string
	/** ISO timestamp of last update */
	updatedAt: string
	/** User email/name (from environment) */
	author?: string
	/** The agent's proposed replacement text (set after preview_address_comment) */
	proposedReplacement?: string
	/** The full diff proposed by the agent (unified diff format) */
	proposedDiff?: string
}

type CommentFile = { moduleId: string; comments: Comment[] }

function moduleFile(moduleId: string): string {
	const safe = moduleId.replace(/[^a-zA-Z0-9._-]+/g, "_") || "unknown"
	return path.join(COMMENTS_DIR, `${safe}.json`)
}

async function loadFile(moduleId: string): Promise<CommentFile> {
	try {
		const raw = await fs.readFile(moduleFile(moduleId), "utf8")
		return JSON.parse(raw) as CommentFile
	} catch {
		return { moduleId, comments: [] }
	}
}

async function saveFile(data: CommentFile): Promise<void> {
	await fs.mkdir(COMMENTS_DIR, { recursive: true })
	await fs.writeFile(moduleFile(data.moduleId), JSON.stringify(data, null, 2), "utf8")
}

export async function addComment(moduleId: string, body: string, anchor: TextAnchor, author?: string): Promise<Comment> {
	const file = await loadFile(moduleId)
	const now = new Date().toISOString()
	const comment: Comment = {
		id: `comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
		moduleId,
		body,
		anchor,
		status: "open",
		createdAt: now,
		updatedAt: now,
		author,
	}
	file.comments.push(comment)
	await saveFile(file)
	return comment
}

export async function getComment(moduleId: string, commentId: string): Promise<Comment | null> {
	const file = await loadFile(moduleId)
	return file.comments.find((c) => c.id === commentId) ?? null
}

export async function listComments(moduleId: string, statusFilter?: CommentStatus): Promise<Comment[]> {
	const file = await loadFile(moduleId)
	return statusFilter ? file.comments.filter((c) => c.status === statusFilter) : file.comments
}

export async function updateComment(
	moduleId: string,
	commentId: string,
	updates: Partial<Pick<Comment, "status" | "proposedReplacement" | "proposedDiff" | "body">>,
): Promise<Comment | null> {
	const file = await loadFile(moduleId)
	const idx = file.comments.findIndex((c) => c.id === commentId)
	if (idx === -1) return null
	file.comments[idx] = {
		...file.comments[idx],
		...updates,
		updatedAt: new Date().toISOString(),
	}
	await saveFile(file)
	return file.comments[idx]
}

export async function resolveComment(moduleId: string, commentId: string): Promise<Comment | null> {
	return updateComment(moduleId, commentId, { status: "addressed" })
}

export async function orphanComment(moduleId: string, commentId: string): Promise<Comment | null> {
	return updateComment(moduleId, commentId, { status: "orphaned" })
}

export async function deleteComment(moduleId: string, commentId: string): Promise<boolean> {
	const file = await loadFile(moduleId)
	const before = file.comments.length
	file.comments = file.comments.filter((c) => c.id !== commentId)
	if (file.comments.length === before) return false
	await saveFile(file)
	return true
}
