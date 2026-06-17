import { type ParseEntry, parse as parseShell } from "shell-quote"

// Conservative deny-list of unambiguously destructive command invocations.
// Each pattern is anchored at the START of a parsed command segment so it only
// matches the command's actual executable + flags, NOT a destructive-looking
// substring that appears inside a quoted argument (e.g. `echo 'rm -rf x'`).
// An optional leading `sudo`/`env`/`command`/`time`/absolute-or-relative-path
// prefix is tolerated. This list is intentionally narrow: it targets operations
// that are irreversible / system-damaging (recursive force delete, raw disk
// writes, filesystem creation, fork bombs, history obliteration) rather than
// ordinary development commands such as build/test/lint/dev-server.
const SEGMENT_LEAD = /^(?:(?:sudo|env|command|time|nice|nohup|doas)\s+)*(?:[\w./-]*\/)?/.source

const DESTRUCTIVE_COMMAND_PATTERNS: RegExp[] = [
	// rm with both recursive and force (any flag ordering / combined short flags)
	new RegExp(
		`${SEGMENT_LEAD}rm\\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-r\\w*\\s+-f\\b|-f\\w*\\s+-r\\b|--recursive\\b.*--force|--force\\b.*--recursive)`,
		"i",
	),
	// recursive removals via find -delete / find -exec rm
	new RegExp(`${SEGMENT_LEAD}find\\b[^\\n]*\\b-delete\\b`, "i"),
	new RegExp(`${SEGMENT_LEAD}find\\b[^\\n]*-exec\\s+rm\\b`, "i"),
	// disk / filesystem destruction
	new RegExp(`${SEGMENT_LEAD}dd\\b[^\\n]*\\bof=/dev/`, "i"),
	new RegExp(`${SEGMENT_LEAD}mkfs(?:\\.\\w+)?\\b`, "i"),
	new RegExp(`${SEGMENT_LEAD}(?:shred|wipefs)\\b`, "i"),
	new RegExp(`${SEGMENT_LEAD}fdisk\\b`, "i"),
	// recursive chmod 777 / recursive chown|chmod from filesystem root
	new RegExp(`${SEGMENT_LEAD}chmod\\s+(?:-R\\s+)?0?777\\s+/`, "i"),
	new RegExp(`${SEGMENT_LEAD}ch(?:own|mod)\\s+-R\\b[^\\n]*\\s/(?:\\s|$)`, "i"),
	// git history / working-tree obliteration
	new RegExp(`${SEGMENT_LEAD}git\\s+(?:reset\\s+--hard|clean\\s+-[a-z]*f|push\\s+.*--force)`, "i"),
]

// Raw-string destructive markers that are meaningful regardless of segment
// position (redirect onto a raw block device, classic fork bomb).
const DESTRUCTIVE_RAW_PATTERNS: RegExp[] = [/>\s*\/dev\/(?:sd[a-z]|nvme\d|disk\d)/i, /:\s*\(\)\s*\{\s*:\s*\|/]

/**
 * Split a command line into command segments using the same shell tokenizer the
 * permission controller relies on (`shell-quote`). Quoted strings collapse into
 * single argument tokens, so destructive-looking text inside quotes does not
 * begin a new segment. Returns the original command as a single segment if
 * tokenization fails.
 */
function splitCommandSegments(command: string): string[] {
	const segments: string[] = []
	try {
		const tokens: ParseEntry[] = parseShell(command)
		let current: string[] = []
		const flush = () => {
			if (current.length > 0) {
				segments.push(current.join(" "))
				current = []
			}
		}
		for (const token of tokens) {
			if (typeof token === "string") {
				current.push(token)
			} else if (token && typeof token === "object" && "pattern" in token) {
				current.push((token as { pattern: string }).pattern)
			} else if (token && typeof token === "object" && "op" in token) {
				// Operators (&&, ||, |, ;, redirects, subshell parens) end a segment
				flush()
			}
		}
		flush()
	} catch {
		// fall through to raw command
	}
	if (segments.length === 0) {
		segments.push(command)
	}
	return segments
}

/**
 * Heuristically determine whether a command line looks destructive enough that
 * the harness should require explicit human approval even when the model marked
 * it as not requiring approval.
 *
 * The decision is made entirely from harness-trusted parsing of the command
 * text — it never consults the model-supplied `requires_approval` flag — so a
 * model cannot opt a destructive command out of this check. The harness signal
 * can only escalate toward asking the human; it never relaxes approval.
 */
export function commandLooksDestructive(command: string): boolean {
	const normalized = command.trim()
	if (!normalized) {
		return false
	}

	for (const pattern of DESTRUCTIVE_RAW_PATTERNS) {
		if (pattern.test(normalized)) {
			return true
		}
	}

	for (const segment of splitCommandSegments(normalized)) {
		const trimmed = segment.trim()
		for (const pattern of DESTRUCTIVE_COMMAND_PATTERNS) {
			if (pattern.test(trimmed)) {
				return true
			}
		}
	}

	return false
}

/** Inputs to the execute_command auto-approval decision. */
export interface ExecuteCommandApprovalInput {
	/** Running on behalf of a subagent (always auto-approved by design). */
	isSubagentExecution: boolean
	/** The model's own `requires_approval` self-classification (model-supplied). */
	requiresApprovalPerLLM: boolean
	/** User opted in to auto-approve commands the model deems safe (harness state). */
	autoApproveSafe: boolean
	/** User opted in to auto-approve ALL commands incl. model-deemed-risky (harness state). */
	autoApproveAll: boolean
	/** The actual command string about to run (harness-inspected). */
	command: string
}

/**
 * Decide whether an execute_command invocation may be auto-approved (run without
 * an explicit human prompt).
 *
 * Security property: the model-supplied `requires_approval` flag must not be the
 * SOLE gate. When the user has enabled "auto-approve safe commands" the model's
 * claim of "safe" (requiresApprovalPerLLM === false) is honored only if the
 * harness's own inspection (`commandLooksDestructive`) does not flag the command
 * as destructive. A prompt-injected / over-eager model therefore cannot mark a
 * destructive command "safe" and have it auto-execute — such a command falls
 * through to manual approval.
 *
 * The all-commands opt-in (autoApproveAll / yolo, surfaced here as
 * autoApproveAll) is unchanged: that is a deliberate, harness-trusted decision
 * by the user to skip approval entirely, including for risky commands.
 */
export function shouldAutoApproveExecuteCommand(input: ExecuteCommandApprovalInput): boolean {
	const { isSubagentExecution, requiresApprovalPerLLM, autoApproveSafe, autoApproveAll, command } = input

	if (isSubagentExecution) {
		return true
	}

	// Model says safe AND user enabled safe-auto-approve AND the harness does not
	// independently consider the command destructive.
	if (!requiresApprovalPerLLM && autoApproveSafe && !commandLooksDestructive(command)) {
		return true
	}

	// Model says risky, but the user explicitly opted in to auto-approve every
	// command (both safe and all toggles on).
	if (requiresApprovalPerLLM && autoApproveSafe && autoApproveAll) {
		return true
	}

	return false
}
