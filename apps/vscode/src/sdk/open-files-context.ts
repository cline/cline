// Tells the model which files are open in the IDE via a system-prompt
// section, so prompts like "read this file" resolve to the active editor
// file (#13503). Captured once at task start in buildSessionConfig.

import { access } from "fs/promises"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"

export function formatOpenFilesSection(visibleFiles: string[], openTabs: string[]): string {
	if (visibleFiles.length === 0 && openTabs.length === 0) {
		return ""
	}
	let section = "\n\n# Open Files in Editor\n\nCaptured from the user's IDE when the task started."
	if (visibleFiles.length > 0) {
		section += `\n\nVisible (active) files:\n${visibleFiles.join("\n")}`
	}
	if (openTabs.length > 0) {
		section += `\n\nOpen tabs:\n${openTabs.join("\n")}`
	}
	section += '\n\nWhen the user refers to "this file" or similar without giving a path, they usually mean the visible file.'
	return section
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

/** Returns the system-prompt section, or "" when nothing is open. */
export async function buildOpenFilesSystemPromptSection(cwd: string): Promise<string> {
	const [visibleTabs, openTabs] = await Promise.all([
		HostProvider.window.getVisibleTabs({}),
		HostProvider.window.getOpenTabs({}),
	])
	const visibleFiles = await normalizeTabPaths(visibleTabs.paths ?? [], cwd)
	const openTabPaths = await normalizeTabPaths(openTabs.paths ?? [], cwd)
	return formatOpenFilesSection(visibleFiles, openTabPaths)
}
