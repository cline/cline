// RFC 0001 (hierarchical workspaces) — Phase 5 host surface.
//
// One resolution of the workspace hierarchy, consumed by every VS Code surface
// that needs it: the status bar, the webview onboarding card, and the History
// tab's workspace scope. Deliberately free of `vscode` imports and of any
// filesystem writes so it can be exercised outside the extension host.
//
// The traversal itself lives in @cline/shared/storage; this module only shapes
// its result for display and for history filtering, so hosts never re-walk the
// filesystem or re-derive precedence rules.

import { basename, resolve, sep } from "node:path"
import {
	loadWorkspaceConfigSync,
	type ResolvedHierarchicalWorkspace,
	resolveHierarchicalWorkspaceSync,
} from "@cline/shared/storage"

/** Workspace history scopes, matching the SDK's `listSessions({ scope })` values. */
export type WorkspaceHistoryScope = "current" | "hierarchical" | "all"

export interface WorkspaceHierarchyLayer {
	/** Absolute path to the layer directory. */
	path: string
	/** Display label: `.cline/workspace.json` name when set, else the folder basename. */
	displayName: string
	/** True for the primary (nearest) workspace root. */
	isPrimary: boolean
	/** The layer is the containing git repository root. */
	isGitRoot: boolean
}

export interface WorkspaceHierarchyInfo {
	/** Directory the resolution started from (the host's workspace folder). */
	targetPath: string
	/** Nearest active workspace root; equals `targetPath` when uninitialized. */
	primaryRoot: string
	/** Whether a `.cline`/`.clinerules` workspace was found at or above `targetPath`. */
	isInitialized: boolean
	/** Ordered layers, root-most ancestor first, primary root last. */
	layers: WorkspaceHierarchyLayer[]
	/** Root-most ancestor layer when the primary root inherits from a parent. */
	inheritedFrom?: WorkspaceHierarchyLayer
}

/** The subset of a session record needed to decide history scope membership. */
export interface WorkspaceScopedSession {
	anchorWorkspacePath?: string | null
	cwd?: string | null
	workspaceRoot?: string | null
}

function withoutTrailingSeparator(value: string): string {
	return value.length > 1 ? value.replace(/[\\/]+$/, "") : value
}

/**
 * Compares absolute paths the way the SDK's anchor matching does: normalized,
 * separator-insensitive, and case-insensitive on Windows.
 */
function pathsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
	if (!a || !b) {
		return false
	}
	const normalizedA = withoutTrailingSeparator(resolve(a))
	const normalizedB = withoutTrailingSeparator(resolve(b))
	return process.platform === "win32" ? normalizedA.toLowerCase() === normalizedB.toLowerCase() : normalizedA === normalizedB
}

function isPathInside(parent: string, candidate: string | null | undefined): boolean {
	if (!candidate) {
		return false
	}
	const normalizedParent = withoutTrailingSeparator(resolve(parent))
	const normalizedCandidate = withoutTrailingSeparator(resolve(candidate))
	const parentPrefix = normalizedParent.endsWith(sep) ? normalizedParent : `${normalizedParent}${sep}`
	return process.platform === "win32"
		? normalizedCandidate.toLowerCase().startsWith(parentPrefix.toLowerCase())
		: normalizedCandidate.startsWith(parentPrefix)
}

function toLayer(path: string, isPrimary: boolean): WorkspaceHierarchyLayer {
	const config = loadWorkspaceConfigSync(path)
	return {
		path,
		displayName: config.name?.trim() || basename(path) || path,
		isPrimary,
		isGitRoot: false,
	}
}

/**
 * Resolve the hierarchy for `targetPath`, degrading to an uninitialized
 * single-layer result rather than throwing: every caller is a UI surface that
 * must still render when the path is unreadable or the traversal fails.
 */
export function resolveWorkspaceHierarchyInfo(targetPath: string): WorkspaceHierarchyInfo {
	const fallback: WorkspaceHierarchyInfo = {
		targetPath,
		primaryRoot: targetPath,
		isInitialized: false,
		layers: [toLayer(targetPath, true)],
	}

	let resolved: ResolvedHierarchicalWorkspace
	try {
		resolved = resolveHierarchicalWorkspaceSync(targetPath)
	} catch {
		return fallback
	}

	if (!resolved.isInitialized) {
		return fallback
	}

	const primaryRoot = resolved.primaryRoot
	const layers: WorkspaceHierarchyLayer[] = resolved.layers.map((layer) => ({
		path: layer.path,
		displayName: layer.config.name?.trim() || basename(layer.path) || layer.path,
		isPrimary: pathsEqual(layer.path, primaryRoot),
		isGitRoot: layer.isGitRoot,
	}))

	// The layers array is ordered root-most ancestor first, so anything above the
	// primary root is an inherited layer and the first entry is the outermost one.
	const primaryIndex = layers.findIndex((layer) => layer.isPrimary)
	const ancestors = primaryIndex > 0 ? layers.slice(0, primaryIndex) : []

	return {
		targetPath,
		primaryRoot,
		isInitialized: true,
		layers: layers.length > 0 ? layers : [toLayer(primaryRoot, true)],
		inheritedFrom: ancestors[0],
	}
}

export interface WorkspaceStatusBarContent {
	/** Status bar label (supports VS Code `$(icon)` codicons). */
	text: string
	/** Markdown tooltip describing the resolved hierarchy. */
	tooltip: string
	/** The primary anchor root shown in the status bar. */
	primaryRoot: string
}

/** Command id invoked when the status bar item is clicked. */
export const WORKSPACE_STATUS_BAR_COMMAND = "cline.workspaceHierarchyClicked"

/**
 * Status bar copy from RFC 0001 §3.1:
 * - direct workspace: `$(folder) Cline: apps/cli`
 * - inherited workspace: `$(repo) Cline: apps/cli (inherited from my-monorepo)`
 */
export function formatWorkspaceStatusBar(info: WorkspaceHierarchyInfo): WorkspaceStatusBarContent {
	const primaryLayer = info.layers.find((layer) => layer.isPrimary) ?? info.layers[info.layers.length - 1]
	const label = info.isInitialized ? primaryLayer.displayName : basename(info.targetPath) || info.targetPath

	if (!info.isInitialized) {
		return {
			text: `$(folder) Cline: ${label}`,
			tooltip: [
				"**Cline workspace**",
				`No \`.cline\` workspace found at or above \`${info.targetPath}\`.`,
				"Initialize one to share rules, skills, and settings with the repository.",
			].join("\n\n"),
			primaryRoot: info.primaryRoot,
		}
	}

	const inherited = info.inheritedFrom ? ` (inherited from ${info.inheritedFrom.displayName})` : ""

	return {
		text: `${inherited ? "$(repo)" : "$(folder)"} Cline: ${label}${inherited}`,
		tooltip: describeWorkspaceHierarchy(info).join("\n\n"),
		primaryRoot: info.primaryRoot,
	}
}

/** Human-readable hierarchy lines, shared by the tooltip and the quick pick. */
export function describeWorkspaceHierarchy(info: WorkspaceHierarchyInfo): string[] {
	if (!info.isInitialized) {
		return ["**Cline workspace**: not initialized", `Target: \`${info.targetPath}\``]
	}

	const lines = [
		`**Cline workspace**: ${info.layers.find((layer) => layer.isPrimary)?.displayName ?? info.primaryRoot}`,
		`Anchor: \`${info.primaryRoot}\``,
	]
	if (info.inheritedFrom) {
		lines.push(`Inherited from: ${info.inheritedFrom.displayName} (\`${info.inheritedFrom.path}\`)`)
	}
	const layerList = info.layers
		.map((layer) => `- ${layer.isPrimary ? "$(check)" : "$(blank)"} ${layer.path}${layer.isGitRoot ? " (git root)" : ""}`)
		.join("\n")
	lines.push(`Active layers (root-most first):\n${layerList}`)
	return lines
}

/**
 * The anchors that count as "this workspace" for the `hierarchical` history
 * scope: the primary root plus every layer it inherits from.
 */
export function workspaceHistoryScopeLayers(info: WorkspaceHierarchyInfo): string[] {
	return info.layers.map((layer) => layer.path)
}

/**
 * Decide whether a session record belongs to the given workspace history scope.
 *
 * Mirrors the SDK's SQL scoping semantics (Phase 3) against records that may
 * predate the `anchor_workspace_path` column: the anchor is authoritative when
 * present, and the raw `cwd`/`workspace_root` values are the legacy fallback.
 */
export function matchesWorkspaceHistoryScope(
	session: WorkspaceScopedSession,
	scope: WorkspaceHistoryScope,
	info: WorkspaceHierarchyInfo,
): boolean {
	if (scope === "all") {
		return true
	}

	const candidates = [session.anchorWorkspacePath, session.cwd, session.workspaceRoot].filter(
		(candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0,
	)
	if (candidates.length === 0) {
		return false
	}

	if (scope === "current") {
		return candidates.some((candidate) => pathsEqual(candidate, info.primaryRoot))
	}

	// "hierarchical" (Include Parent): anchored at the primary root or one of its
	// ancestor layers, or nested anywhere beneath the primary root (a sub-cline
	// deeper in the tree, including one opened directly as the workspace folder).
	return candidates.some(
		(candidate) =>
			workspaceHistoryScopeLayers(info).some((layer) => pathsEqual(candidate, layer)) ||
			isPathInside(info.primaryRoot, candidate),
	)
}
