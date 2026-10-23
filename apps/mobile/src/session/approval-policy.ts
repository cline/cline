/**
 * Device-side approval choices for reads, edits, and commands. Unknown and
 * namespaced tools use the execute tier; that tier's setting determines whether
 * they run automatically or ask. Namespaces are never unwrapped because a remote
 * tool named `read_file` need not behave like the builtin.
 */

/** Tool tiers, ordered from least to most dangerous. */
export const APPROVAL_TIERS = ["read", "write", "execute"] as const;

export type ApprovalTier = (typeof APPROVAL_TIERS)[number];

/** Per-tier decision: answer approvals automatically, or ask the user. */
export type ApprovalTierSetting = "auto" | "ask";

/** The user's auto-approve configuration: one setting per tier. */
export type ApprovalPolicy = Record<ApprovalTier, ApprovalTierSetting>;

/** New installations auto-approve all tiers; saved choices override this default. */
export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
	read: "auto",
	write: "auto",
	execute: "auto",
};

/**
 * The tools this build recognises, and where they sit.
 *
 * Every non-`execute` entry is derived from the SDK, not from what the name reads
 * like, because the two do not always agree. A name is classified as read or write
 * only when **both** hold:
 *
 * 1. It is a tool this monorepo actually ships — a `createTool({ name })` in
 *    `sdk/packages/core/src/extensions/tools/definitions.ts`, listed in
 *    `DefaultToolNames` (`.../tools/constants.ts`) — or a key of the
 *    configured-agent alias table `CONFIGURED_AGENT_TOOL_NAME_ALIASES`
 *    (`sdk/packages/core/src/runtime/orchestration/runtime-builder.ts:90`), which
 *    is how a legacy name reaches the runtime at all.
 * 2. What it *resolves to* through that alias table is a read-only or
 *    file-editing builtin — never `run_commands` (shell), `skills` (runs a
 *    configured skill) or `fetch_web_content` (network egress).
 *
 * Rule 2 is not hypothetical: `list_files` reads like a directory listing and the
 * alias table maps it to `run_commands`, the arbitrary-shell tool. It is
 * therefore `execute` here. `approval-policy.test.ts` re-reads both SDK files and
 * fails if the alias table drifts again.
 *
 * ### Provenance is unavailable
 *
 * `PendingApprovalInfo` (`sdk/packages/shared/src/hub.ts:892`) carries no source,
 * plugin or origin field, and plugin-contributed tools keep their raw
 * `tool.name` (`sdk/packages/core/src/services/plugin-tools.ts:217`) while
 * `createTool` accepts any string. So a bare name cannot be attributed, and a
 * workspace plugin that names its tool `read_files` is classified as if it
 * were the builtin. Until the payload carries provenance the only defence is to
 * keep this list to names the monorepo genuinely ships — which is why `view`,
 * `create`, `insert` and `str_replace` are **not** here: they are `editor`
 * *commands*, no shipped tool is named any of them, so a read/write tier for them
 * could only ever have been claimed by an unknown third party.
 *
 * The execute-tier entries are listed for the reader's benefit; an unlisted name
 * lands there anyway.
 */
const TOOL_TIERS: ReadonlyMap<string, ApprovalTier> = new Map([
	// read — resolve to `read_files` / `search_codebase`
	["read_files", "read"],
	["read_file", "read"],
	["search_codebase", "read"],
	["search_files", "read"],
	["list_code_definition_names", "read"],
	// write — resolve to `editor` / `apply_patch`
	["editor", "write"],
	["apply_patch", "write"],
	["apply_diff", "write"],
	["replace_in_file", "write"],
	["write_to_file", "write"],
	// execute — arbitrary shell, skills, or network egress
	["run_commands", "execute"],
	["bash", "execute"],
	["execute_command", "execute"],
	// Aliases to `run_commands` despite the innocuous name. See rule 2 above.
	["list_files", "execute"],
	["skills", "execute"],
	["use_skill", "execute"],
	["fetch_web_content", "execute"],
]);

/** Separators that mark a name as belonging to some other tool namespace. */
const NAMESPACE_PATTERN = /__|[:./]/;

/**
 * Sort a tool name into a tier. Unknown or namespaced names are `execute`.
 */
export function classifyTool(toolName: string): ApprovalTier {
	const normalized = toolName.trim().toLowerCase();
	if (NAMESPACE_PATTERN.test(normalized)) {
		return "execute";
	}
	return TOOL_TIERS.get(normalized) ?? "execute";
}

/** True when `policy` lets this tool's tier be answered without asking. */
export function shouldAutoApprove(
	toolName: string,
	policy: ApprovalPolicy,
): boolean {
	return policy[classifyTool(toolName)] === "auto";
}
