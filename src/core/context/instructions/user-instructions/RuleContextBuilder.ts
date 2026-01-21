import { HostProvider } from "@/hosts/host-provider"
import { extractPathLikeStrings, RuleEvaluationContext, toWorkspaceRelativePosixPath } from "./rule-conditionals"

type WorkspaceRoot = { path: string }
type WorkspaceManagerLike = { getRoots(): WorkspaceRoot[] }

type ClineMessageLike = {
	type: string
	ask?: string
	say?: string
	text?: string
}

type MessageStateHandlerLike = {
	getClineMessages(): ClineMessageLike[]
}

export type RuleContextBuilderDeps = {
	cwd: string
	messageStateHandler: MessageStateHandlerLike
	workspaceManager?: WorkspaceManagerLike
}

/**
 * Builds the evaluation context used for conditional Cline Rules (e.g. YAML frontmatter `paths:`).
 *
 * Kept in the user-instructions domain so Task remains orchestration-focused.
 *
 * Path context is gathered from multiple sources in clineMessages:
 * - User messages (task, user_feedback)
 * - Visible/open tabs
 * - Tool results (say="tool") - completed operations
 * - Tool requests (ask="tool") - pending operations (captures intent before execution)
 */
export class RuleContextBuilder {
	/**
	 * Maximum number of path candidates to consider for rule activation.
	 * This cap prevents performance degradation in long-running tasks with many file operations.
	 */
	static readonly MAX_RULE_PATH_CANDIDATES = 100

	static async buildEvaluationContext(deps: RuleContextBuilderDeps): Promise<RuleEvaluationContext> {
		return {
			paths: await RuleContextBuilder.getRulePathContext(deps),
		}
	}

	/**
	 * Parse apply_patch input to extract target file paths from patch headers.
	 * Matches lines like: *** Add File: path/to/file.ts
	 */
	private static extractPathsFromApplyPatch(input: string): string[] {
		if (typeof input !== "string" || !input) return []

		const paths: string[] = []
		const fileHeaderRegex = /^\*\*\* (?:Add|Update|Delete) File: (.+?)(?:\n|$)/gm
		let m: RegExpExecArray | null
		while ((m = fileHeaderRegex.exec(input))) {
			const filePath = (m[1] || "").trim()
			if (filePath) {
				paths.push(filePath)
			}
		}
		return paths
	}

	private static async getRulePathContext(deps: RuleContextBuilderDeps): Promise<string[]> {
		const candidates: string[] = []
		const clineMessages = deps.messageStateHandler.getClineMessages()

		// (1) Current-turn user message evidence:
		// Use the most recent user-authored text (initial task or subsequent feedback).
		// NOTE: We intentionally prefer the latest user_feedback over the original task to
		// support first-turn activation on later turns.
		const lastUserMsg = [...clineMessages]
			.reverse()
			.find((m) => m.type === "say" && (m.say === "user_feedback" || m.say === "task") && typeof m.text === "string")
		if (lastUserMsg?.text) {
			candidates.push(...extractPathLikeStrings(lastUserMsg.text))
		}

		// (2) Visible + open tabs
		const roots = deps.workspaceManager?.getRoots().map((r) => r.path) ?? [deps.cwd]
		const rawVisiblePaths = (await HostProvider.window.getVisibleTabs({}))?.paths ?? []
		const rawOpenTabPaths = (await HostProvider.window.getOpenTabs({}))?.paths ?? []
		for (const abs of [...rawVisiblePaths, ...rawOpenTabPaths]) {
			for (const root of roots) {
				const rel = toWorkspaceRelativePosixPath(abs, root)
				if (rel) {
					candidates.push(rel)
					break
				}
			}
		}

		// (3) Files edited by Cline during this task (completed operations):
		// Parse say="tool" messages for tool results indicating file operations.
		for (const msg of clineMessages) {
			if (msg.type !== "say" || msg.say !== "tool" || !msg.text) continue
			try {
				const tool = JSON.parse(msg.text) as { tool?: string; path?: string }
				if (
					(tool.tool === "editedExistingFile" || tool.tool === "newFileCreated" || tool.tool === "fileDeleted") &&
					tool.path
				) {
					candidates.push(tool.path)
				}
			} catch {
				// ignore parse errors
			}
		}

		// (4) Tool requests (pending operations):
		// Parse ask="tool" messages to capture the assistant's intent BEFORE tool execution.
		// This enables rule activation even when:
		// - The tool hasn't completed yet
		// - The tool fails (intent was still expressed)
		// - Files don't exist yet (new file creation)
		for (const msg of clineMessages) {
			if (msg.type !== "ask" || msg.ask !== "tool" || !msg.text) continue
			try {
				const tool = JSON.parse(msg.text) as {
					tool?: string
					path?: string
					content?: string // apply_patch stores patch content here
				}

				// Extract path from standard file tools
				if (tool.path) {
					candidates.push(tool.path)
				}

				// Handle apply_patch specially: parse patch headers for file paths
				if (tool.tool === "applyPatch" && tool.content) {
					candidates.push(...RuleContextBuilder.extractPathsFromApplyPatch(tool.content))
				}
			} catch {
				// ignore parse errors
			}
		}

		// Normalize/dedupe/cap
		const seen = new Set<string>()
		const normalized: string[] = []
		for (const c of candidates) {
			const posix = c.replace(/\\/g, "/").replace(/^\//, "")
			if (!posix || posix === "/") continue
			if (seen.has(posix)) continue
			seen.add(posix)
			normalized.push(posix)
			if (normalized.length >= RuleContextBuilder.MAX_RULE_PATH_CANDIDATES) break
		}
		return normalized.sort()
	}
}
