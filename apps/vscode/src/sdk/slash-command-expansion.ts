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
 * Find the runtime command matching a typed slash-command name.
 *
 * The SDK names workflows by frontmatter `name` or file basename *without* the
 * extension, but the webview autocomplete (and legacy Cline versions) surface
 * workflow files as `/my-workflow.md`. Accept both spellings so workflows
 * created under the legacy extension keep working after an upgrade.
 */
function findRuntimeCommand(
	commands: readonly AvailableRuntimeCommand[],
	typedName: string,
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
 *
 * @param disabledWorkflowNames canonical (extension-less, lower-cased) workflow
 *   names the user disabled via the Workflows toggles, from
 *   {@link buildDisabledWorkflowNames}. Disabled workflows are left unexpanded,
 *   matching legacy semantics.
 */
export function expandSlashCommands(
	text: string,
	commands: readonly AvailableRuntimeCommand[],
	disabledWorkflowNames: ReadonlySet<string> = new Set(),
): string {
	if (!text.includes("/") || commands.length === 0) {
		return text
	}
	for (const match of text.matchAll(SLASH_COMMAND_TOKEN_REGEX)) {
		const token = match[2]
		const typedName = token.slice(1)
		const command = findRuntimeCommand(commands, typedName)
		if (!command) {
			continue
		}
		if (command.kind === "workflow" && disabledWorkflowNames.has(canonicalWorkflowName(command.name))) {
			continue
		}
		const start = (match.index ?? 0) + match[1].length
		const end = start + token.length
		return text.slice(0, start) + command.instructions + text.slice(end)
	}
	return text
}

export interface BuildDisabledWorkflowNamesOptions {
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
 * Build the set of canonical workflow names the user disabled via the Workflows
 * toggles (local, global, and enterprise/remote scopes).
 *
 * A name is disabled only when *no* toggle entry for it is enabled: legacy
 * expansion only searched enabled workflows across scopes, so a disabled
 * workspace file must not shadow a same-named enabled global one (or vice
 * versa). Locked (`alwaysEnabled`) remote workflows always count as enabled.
 */
export function buildDisabledWorkflowNames(options: BuildDisabledWorkflowNamesOptions): Set<string> {
	const enabledByName = new Map<string, boolean>()
	const register = (rawName: string, enabled: boolean) => {
		const name = canonicalWorkflowName(rawName)
		if (!name) {
			return
		}
		enabledByName.set(name, (enabledByName.get(name) ?? false) || enabled)
	}

	for (const toggles of [options.globalToggles ?? {}, options.workspaceToggles ?? {}]) {
		for (const [filePath, enabled] of Object.entries(toggles)) {
			register(filePath.replace(/^.*[/\\]/, ""), enabled)
		}
	}
	for (const [name, enabled] of Object.entries(options.remoteToggles ?? {})) {
		register(name, enabled)
	}
	for (const name of options.remoteAlwaysEnabledNames ?? []) {
		register(name, true)
	}

	const disabled = new Set<string>()
	for (const [name, enabled] of enabledByName) {
		if (!enabled) {
			disabled.add(name)
		}
	}
	return disabled
}
