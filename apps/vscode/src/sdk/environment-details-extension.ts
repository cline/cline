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
 * Append the environment-details block as a trailing user message on the
 * outbound copy. A separate message (rather than editing the last user
 * message) matches how the runtime already delivers <hook_context> blocks, so
 * tool-result parts stay contiguous for providers that require them first.
 */
export function appendEnvironmentDetailsMessage(messages: Message[], details: string): Message[] {
	if (messages.length === 0) {
		return messages
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
		manifest: { capabilities: ["messageBuilders"] },
		setup(api) {
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
