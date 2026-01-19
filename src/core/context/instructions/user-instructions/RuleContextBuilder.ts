import { HostProvider } from "@/hosts/host-provider"
import { extractPathLikeStrings, RuleEvaluationContext, toWorkspaceRelativePosixPath } from "./rule-conditionals"

type WorkspaceRoot = { path: string }
type WorkspaceManagerLike = { getRoots(): WorkspaceRoot[] }

type ClineMessageLike = {
	type: string
	say?: string
	text?: string
}

type MessageStateHandlerLike = {
	getClineMessages(): ClineMessageLike[]
}

type TaskStateLike = {
	rulePathIntentCandidates?: Set<string>
}

export type RuleContextBuilderDeps = {
	cwd: string
	taskState: TaskStateLike
	messageStateHandler: MessageStateHandlerLike
	workspaceManager?: WorkspaceManagerLike
}

/**
 * Builds the evaluation context used for conditional Cline Rules (e.g. YAML frontmatter `paths:`).
 *
 * Kept in the user-instructions domain so Task remains orchestration-focused.
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

	private static async getRulePathContext(deps: RuleContextBuilderDeps): Promise<string[]> {
		const candidates: string[] = []

		// (0) Tool-intent evidence: paths the assistant has explicitly targeted via tool calls.
		// This is especially important for new files (non-existent at the time of first mention).
		if (deps.taskState.rulePathIntentCandidates?.size) {
			candidates.push(...Array.from(deps.taskState.rulePathIntentCandidates))
		}

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
		const rawVisiblePaths = (await HostProvider.window.getVisibleTabs({})).paths
		const rawOpenTabPaths = (await HostProvider.window.getOpenTabs({})).paths
		for (const abs of [...rawVisiblePaths, ...rawOpenTabPaths]) {
			for (const root of roots) {
				const rel = toWorkspaceRelativePosixPath(abs, root)
				if (rel) {
					candidates.push(rel)
					break
				}
			}
		}

		// (3) Files edited by Cline during this task: use fileContextTracker metadata heuristics.
		// We can approximate this by looking for tool messages indicating edits.
		for (const msg of clineMessages) {
			if (msg.say !== "tool" || !msg.text) continue
			try {
				const tool = JSON.parse(msg.text) as { tool?: string; path?: string }
				if (
					(tool.tool === "editedExistingFile" || tool.tool === "newFileCreated" || tool.tool === "fileDeleted") &&
					tool.path
				) {
					candidates.push(tool.path)
				}
			} catch {
				// ignore
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
