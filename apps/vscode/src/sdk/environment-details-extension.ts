// Restores the legacy extension's per-request IDE context ("VSCode Visible
// Files" / "VSCode Open Tabs" from the old getEnvironmentDetails) for the
// SDK-based extension (#13503).
//
// Implemented as an SDK message-builder extension: builders run inside the
// runtime's beforeModel hook on every model request and transform only the
// outbound provider copy of the conversation. The injected block is therefore
// always fresh, never persisted to the transcript, and never rendered in the
// UI — while every earlier message stays byte-identical, preserving provider
// prompt-prefix caches.

import type { AgentExtension, Message } from "@cline/shared"
import { access } from "fs/promises"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"

export const ENVIRONMENT_DETAILS_BUILDER_NAME = "vscode-environment-details"

/**
 * System-prompt rule explaining the injected block. The legacy system prompt
 * carried equivalent guidance; without it models treat the block
 * inconsistently (e.g. still asking which file to read when one is open).
 */
export const ENVIRONMENT_DETAILS_RULE = `ENVIRONMENT DETAILS

Each user message automatically includes an <environment_details> block listing the files currently visible and the tabs currently open in the user's IDE. This is auto-generated IDE context, not written by the user. Use it to ground your work in what the user is looking at. When the user refers to "this file", "the file", "current file", or similar without giving a path, they mean the visible (active) file listed there — resolve the path from the Visible Files section and proceed. Do not ask the user which file they mean when the visible files answer it. Do not treat the block as part of the user's request unless they clearly refer to it.`

/**
 * Format the environment-details block appended to each model request.
 * Mirrors the legacy getEnvironmentDetails section headers so models see the
 * same "# <IDE> Visible Files" / "# <IDE> Open Tabs" convention they've
 * always been prompted with.
 */
export function formatEnvironmentDetails(platform: string, visibleFiles: string[], openTabs: string[]): string {
	const visible = visibleFiles.length > 0 ? visibleFiles.join("\n") : "(No visible files)"
	const open = openTabs.length > 0 ? openTabs.join("\n") : "(No open tabs)"
	return `<environment_details>\n# ${platform} Visible Files\n${visible}\n\n# ${platform} Open Tabs\n${open}\n</environment_details>`
}

/**
 * Append the environment-details block to the outbound copy. When the last
 * message is a plain user message, the block is appended as an extra text
 * part of that message (the legacy shape, which keeps it strongly associated
 * with the request). After tool results, it is delivered as a separate
 * trailing user message instead — the same shape the runtime uses for
 * <hook_context> blocks — so tool-result parts stay contiguous for providers
 * that require them first.
 */
export function appendEnvironmentDetailsMessage(messages: Message[], details: string): Message[] {
	if (messages.length === 0) {
		return messages
	}
	const last = messages[messages.length - 1]
	const lastContent = typeof last.content === "string" ? [{ type: "text" as const, text: last.content }] : last.content
	if (last.role === "user" && !lastContent.some((part) => part.type === "tool_result")) {
		const merged = { ...last, content: [...lastContent, { type: "text" as const, text: details }] }
		return [...messages.slice(0, -1), merged]
	}
	return [...messages, { role: "user", content: [{ type: "text", text: details }] }]
}

/** Dedupe, keep only files that still exist, and relativize against cwd. */
export async function normalizeTabPaths(rawPaths: string[], cwd: string): Promise<string[]> {
	const seen = new Set<string>()
	const results: string[] = []
	for (const rawPath of rawPaths) {
		if (!rawPath || seen.has(rawPath)) {
			continue
		}
		seen.add(rawPath)
		try {
			await access(rawPath)
		} catch {
			continue
		}
		results.push(path.relative(cwd, rawPath).replace(/\\/g, "/"))
	}
	return results
}

async function collectEnvironmentDetails(cwd: string): Promise<string | undefined> {
	const [host, visibleTabs, openTabs] = await Promise.all([
		HostProvider.env.getHostVersion({}),
		HostProvider.window.getVisibleTabs({}),
		HostProvider.window.getOpenTabs({}),
	])
	const visibleFiles = await normalizeTabPaths(visibleTabs.paths ?? [], cwd)
	const openTabPaths = await normalizeTabPaths(openTabs.paths ?? [], cwd)
	return formatEnvironmentDetails(host.platform || "IDE", visibleFiles, openTabPaths)
}

/**
 * SDK extension that injects the IDE's visible files and open tabs into every
 * model request. Registered via CoreSessionConfig.extensions in
 * buildSessionConfig.
 */
export function createEnvironmentDetailsExtension(cwd: string): AgentExtension {
	return {
		name: ENVIRONMENT_DETAILS_BUILDER_NAME,
		manifest: { capabilities: ["messageBuilders", "rules"] },
		setup(api) {
			api.registerRule({
				id: ENVIRONMENT_DETAILS_BUILDER_NAME,
				content: ENVIRONMENT_DETAILS_RULE,
			})
			api.registerMessageBuilder({
				name: ENVIRONMENT_DETAILS_BUILDER_NAME,
				build: async (messages) => {
					try {
						const details = await collectEnvironmentDetails(cwd)
						return details ? appendEnvironmentDetailsMessage(messages, details) : messages
					} catch (error) {
						// IDE context is best-effort — never fail the turn over it.
						Logger.debug("[EnvironmentDetails] Failed to collect IDE context:", error)
						return messages
					}
				},
			})
		},
	}
}
