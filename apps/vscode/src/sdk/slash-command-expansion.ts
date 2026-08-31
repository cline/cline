import type { AvailableRuntimeCommand } from "@cline/core"

/**
 * Matches a slash-command token that is either at the start of the message or
 * preceded by whitespace, and followed by whitespace or end-of-string. Kept in
 * sync with the webview's `slashCommandRegex` (webview-ui/src/utils/slash-commands.ts)
 * so anything the chat input highlights/autocompletes as a command can be expanded.
 */
const SLASH_COMMAND_TOKEN_REGEX = /(^|\s)(\/[a-zA-Z0-9_.:@-]+)(?=\s|$)/g

/**
 * File extensions the SDK's workflow discovery accepts (`MARKDOWN_EXTENSIONS`
 * in @cline/core's user-instruction-config-loader). The SDK strips the
 * extension when naming the command; the webview autocomplete and legacy
 * toggle state keep it.
 */
const WORKFLOW_FILE_EXTENSION_REGEX = /\.(md|markdown|txt)$/i

/**
 * Canonical form used to compare workflow names across the places they appear:
 * typed slash commands and toggle paths keep the file extension, while SDK
 * command names and remote workflow names do not.
 */
function canonicalWorkflowName(value: string): string {
	const stripped = value.replace(WORKFLOW_FILE_EXTENSION_REGEX, "").toLowerCase()
	return stripped || value.toLowerCase()
}

/**
 * Verbatim port of @cline/shared's private `sanitizeSegment`
 * (src/remote-config/materializer.ts), which names the files that remote
 * workflows materialize to — lower-cased, disallowed character runs collapsed
 * to `-`, capped at 80 characters. Keep in sync with the original.
 */
function sanitizeRemoteSegment(value: string): string {
	let result = ""
	let pendingSeparator = false
	for (const char of value.trim().toLowerCase()) {
		const code = char.charCodeAt(0)
		const isAllowed =
			(code >= 97 && code <= 122) || (code >= 48 && code <= 57) || char === "." || char === "_" || char === "-"
		if (isAllowed) {
			if (pendingSeparator && result && result[result.length - 1] !== "-") {
				result += "-"
			}
			pendingSeparator = false
			result += char
		} else {
			pendingSeparator = true
		}
		if (result.length >= 80) {
			break
		}
	}
	while (result.endsWith("-")) {
		result = result.slice(0, -1)
	}
	while (result.startsWith("-")) {
		result = result.slice(1)
	}
	return result || "item"
}

/**
 * Comparison key for remote workflow names. The discovered record is named
 * after the sanitized file basename, while remote toggles are keyed by the
 * original config name (e.g. "Org Standards"), so apply the materializer's
 * exact transformation to both sides before comparing (it is idempotent on
 * already-sanitized names).
 */
function remoteWorkflowNameKey(value: string): string {
	return sanitizeRemoteSegment(value.replace(WORKFLOW_FILE_EXTENSION_REGEX, ""))
}

function fileBasename(filePath: string): string {
	return filePath.replace(/^.*[/\\]/, "")
}

/** Matches files materialized from remote config (`.cline/remote-config/…`). */
const REMOTE_CONFIG_PATH_REGEX = /[/\\]\.cline[/\\]remote-config[/\\]/

/** The discovered workflow files toggle filtering and matching operate on. */
export interface WorkflowRecordRef {
	/** Stable runtime command ID. */
	id?: string
	/** Command name (frontmatter `name`, or file basename without extension). */
	name: string
	/** Absolute path of the workflow file. */
	filePath: string
}

export interface ExpandSlashCommandsOptions {
	/**
	 * Exact command names of workflows the user disabled via the Workflows
	 * toggles, from {@link buildDisabledWorkflowNames}. Disabled workflows are
	 * left unexpanded, matching legacy semantics.
	 */
	disabledWorkflowNames?: ReadonlySet<string>
	/**
	 * Discovered workflow records, used to also match a typed file name (e.g.
	 * `/my-workflow.md`, what the autocomplete inserts) against a workflow
	 * whose frontmatter `name` differs from its filename.
	 */
	workflowRecords?: ReadonlyArray<WorkflowRecordRef>
}

/**
 * Find the runtime command matching a typed slash-command name.
 *
 * The SDK names workflows by frontmatter `name` or file basename *without* the
 * extension, but the webview autocomplete (and legacy Cline versions) surface
 * workflow files as `/my-workflow.md`. Accept both spellings — and resolve a
 * typed file name to its frontmatter-renamed command — so workflows created
 * under the legacy extension keep working after an upgrade.
 */
function findRuntimeCommand(
	commands: readonly AvailableRuntimeCommand[],
	typedName: string,
	workflowRecords: ReadonlyArray<WorkflowRecordRef>,
): AvailableRuntimeCommand | undefined {
	const withoutExtension = typedName.replace(WORKFLOW_FILE_EXTENSION_REGEX, "")
	const candidates = withoutExtension && withoutExtension !== typedName ? [typedName, withoutExtension] : [typedName]
	for (const candidate of candidates) {
		const exact = commands.find((command) => command.name === candidate)
		if (exact) {
			return exact
		}
	}
	// The webview highlights/validates slash commands case-insensitively, so
	// fall back to a case-insensitive match rather than silently not expanding.
	for (const candidate of candidates) {
		const lowered = candidate.toLowerCase()
		const insensitive = commands.find((command) => command.name.toLowerCase() === lowered)
		if (insensitive) {
			return insensitive
		}
	}
	// Typed file name (autocomplete inserts `/my-workflow.md`) whose workflow
	// was renamed via frontmatter: resolve through the record's file basename.
	const typedCanonical = canonicalWorkflowName(typedName)
	const record = workflowRecords.find((r) => canonicalWorkflowName(fileBasename(r.filePath)) === typedCanonical)
	if (record) {
		// Match by the stable record id: the SDK normalizes command names
		// (e.g. "Ship It" -> "ship-it"), so the configured record name no
		// longer compares equal to the command token. Keep the canonical-name
		// comparison as a fallback for callers that pass records without ids.
		const byId = record.id === undefined ? undefined : commands.find((command) => command.id === record.id)
		if (byId) {
			return byId
		}
		const recordCanonical = canonicalWorkflowName(record.name)
		return commands.find((command) => canonicalWorkflowName(command.name) === recordCanonical)
	}
	return undefined
}

/**
 * Expand the first slash command in `text` that resolves to a known
 * workflow/skill into its instruction body.
 *
 * Unlike the SDK's `resolveRuntimeSlashCommand` (leading `/command` only), this
 * matches commands anywhere in the message — the webview lets users insert a
 * slash command after whitespace mid-message, and the legacy extension expanded
 * those too. Only the first matching command is expanded, mirroring legacy
 * behavior and the webview menu (which only offers suggestions for the first
 * command in a message).
 */
export function expandSlashCommands(
	text: string,
	commands: readonly AvailableRuntimeCommand[],
	options: ExpandSlashCommandsOptions = {},
): string {
	if (!text.includes("/") || commands.length === 0) {
		return text
	}
	const disabledWorkflowNames = options.disabledWorkflowNames ?? new Set()
	const workflowRecords = options.workflowRecords ?? []
	for (const match of text.matchAll(SLASH_COMMAND_TOKEN_REGEX)) {
		const token = match[2]
		const typedName = token.slice(1)
		const command = findRuntimeCommand(commands, typedName, workflowRecords)
		if (!command) {
			continue
		}
		if (command.kind === "workflow") {
			const configuredName = workflowRecords.find((record) => record.id === command.id)?.name ?? command.name
			if (disabledWorkflowNames.has(configuredName)) {
				continue
			}
		}
		// Configured skills are not expanded into the prompt: the SDK session
		// registers the `skills` tool, whose description requires the model to
		// invoke it when the user references a slash command, so the
		// instructions arrive as a tool result and the transcript keeps the
		// typed command. Builtins (e.g. /deep-planning) are declared as kind
		// "skill" but are not served by that tool, so they keep expanding —
		// as do workflows.
		if (command.kind === "skill" && !command.id.startsWith("builtin:")) {
			continue
		}
		const start = (match.index ?? 0) + match[1].length
		const end = start + token.length
		return text.slice(0, start) + command.instructions + text.slice(end)
	}
	return text
}

export interface BuildDisabledWorkflowNamesOptions {
	/** Discovered workflow records from `listRecords("workflow")`. */
	records: ReadonlyArray<WorkflowRecordRef>
	/** `globalWorkflowToggles` (global settings) — keyed by absolute file path. */
	globalToggles?: Record<string, boolean>
	/** Workspace `workflowToggles` — keyed by absolute file path. */
	workspaceToggles?: Record<string, boolean>
	/** `remoteWorkflowToggles` (global state) — keyed by remote workflow name. */
	remoteToggles?: Record<string, boolean>
	/** Names of remote workflows the organization locks on (`alwaysEnabled`). */
	remoteAlwaysEnabledNames?: Iterable<string>
}

/**
 * Build the set of exact command names whose workflows the user disabled via
 * the Workflows toggles (local, global, and enterprise/remote scopes).
 *
 * Each command is governed by the toggle state of its own record — the file
 * whose body would actually expand — so a disabled workflow in one scope can
 * neither suppress nor unlock a *different* command that happens to share a
 * similar name in another scope. (The SDK keeps one record per command name,
 * so per-record evaluation is per-command evaluation.)
 *
 * Toggle state is matched to a record by its file basename, so a frontmatter
 * `name` that differs from the filename is still governed by the file's
 * toggle. A basename toggled in several scopes counts as enabled when *any*
 * scope has it enabled: those files collapse into a single record, and legacy
 * expansion only searched enabled workflows across scopes, so a disabled
 * workspace file must not shadow a same-named enabled global one (or vice
 * versa). Files materialized from remote config are governed by the
 * name-keyed remote toggles instead, and locked (`alwaysEnabled`) remote
 * workflows always count as enabled.
 */
export function buildDisabledWorkflowNames(options: BuildDisabledWorkflowNamesOptions): Set<string> {
	const enabledByBasename = new Map<string, boolean>()
	for (const toggles of [options.globalToggles ?? {}, options.workspaceToggles ?? {}]) {
		for (const [filePath, enabled] of Object.entries(toggles)) {
			const key = canonicalWorkflowName(fileBasename(filePath))
			if (!key) {
				continue
			}
			enabledByBasename.set(key, (enabledByBasename.get(key) ?? false) || enabled)
		}
	}
	// Distinct config names can sanitize to the same materialized name (case,
	// punctuation, or the 80-char cap); merge collisions as enabled-if-any-
	// enabled rather than letting the last entry win arbitrarily.
	const remoteToggles = new Map<string, boolean>()
	for (const [name, enabled] of Object.entries(options.remoteToggles ?? {})) {
		const key = remoteWorkflowNameKey(name)
		remoteToggles.set(key, (remoteToggles.get(key) ?? false) || enabled)
	}
	const remoteAlwaysEnabled = new Set([...(options.remoteAlwaysEnabledNames ?? [])].map(remoteWorkflowNameKey))

	const disabled = new Set<string>()
	for (const record of options.records) {
		if (!record.name) {
			continue
		}
		let enabled: boolean
		if (REMOTE_CONFIG_PATH_REGEX.test(record.filePath)) {
			// Key off the materialized file basename — the materializer derives it
			// from the remote config name, so it stays correct even when the file's
			// frontmatter aliases the command name to something else.
			const remoteKey = remoteWorkflowNameKey(fileBasename(record.filePath))
			enabled = remoteAlwaysEnabled.has(remoteKey) || remoteToggles.get(remoteKey) !== false
		} else {
			enabled = enabledByBasename.get(canonicalWorkflowName(fileBasename(record.filePath))) ?? true
		}
		if (!enabled) {
			disabled.add(record.name)
		}
	}
	return disabled
}
