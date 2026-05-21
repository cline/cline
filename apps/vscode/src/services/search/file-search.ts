import type { WorkspaceRoot } from "@shared/multi-root/types"
import * as childProcess from "child_process"
import * as fs from "fs"
import type { FzfResultItem } from "fzf"
import * as path from "path"
import * as readline from "readline"
import { WorkspaceRootManager } from "@/core/workspace"
import { HostProvider } from "@/hosts/host-provider"
import { GetOpenTabsRequest } from "@/shared/proto/host/window"
import { SearchWorkspaceItemsRequest, SearchWorkspaceItemsRequest_SearchItemType } from "@/shared/proto/host/workspace"
import { Logger } from "@/shared/services/Logger"
import { getBinaryLocation } from "@/utils/fs"

/**
 * Indicates which backend served a workspace-files search.
 *
 * - `host_index`: served by the host's native file-name index (e.g. JetBrains FilenameIndex).
 * - `ripgrep`:    served by the bundled ripgrep walker (default everywhere).
 */
export type FileSearchSource = "host_index" | "ripgrep"

// Wrapper function for childProcess.spawn
export type SpawnFunction = typeof childProcess.spawn
export const getSpawnFunction = (): SpawnFunction => childProcess.spawn

/** Thrown when ripgrep fails to spawn or exits non-zero. */
export class RipgrepError extends Error {
	public readonly stderr: string

	constructor(message: string, opts: { stderr?: string } = {}) {
		super(message)
		this.name = "RipgrepError"
		this.stderr = opts.stderr ?? ""
	}
}

export async function executeRipgrepForFiles(
	workspacePath: string,
	limit = 5000,
): Promise<{ path: string; type: "file" | "folder"; label?: string }[]> {
	const rgPath = await getBinaryLocation("rg")

	return new Promise((resolve, reject) => {
		// Arguments for ripgrep to list files, follow symlinks, include hidden, and exclude common directories
		const args = [
			"--files",
			"--follow",
			"--hidden",
			"-g",
			"!**/{node_modules,.git,.github,out,dist,__pycache__,.venv,.env,venv,env,.cache,tmp,temp}/**",
			workspacePath,
		]

		// Spawn the ripgrep process with the specified arguments
		const rgProcess = getSpawnFunction()(rgPath, args)
		const rl = readline.createInterface({ input: rgProcess.stdout })

		// Array to store file results and Set to track unique directories
		const fileResults: { path: string; type: "file" | "folder"; label?: string }[] = []
		const dirSet = new Set<string>()
		let count = 0
		let exitCode: number | null = null

		// Handle each line of output from ripgrep (each line is a file path)
		rl.on("line", (line) => {
			if (count >= limit) {
				rl.close()
				rgProcess.kill()
				return
			}

			// Convert absolute path to a relative path from workspace root
			const relativePath = path.relative(workspacePath, line)

			// Add file result to array
			fileResults.push({
				path: relativePath,
				type: "file",
				label: path.basename(relativePath),
			})

			// Extract and add parent directories to the set
			let dirPath = path.dirname(relativePath)
			while (dirPath && dirPath !== "." && dirPath !== "/") {
				dirSet.add(dirPath)
				dirPath = path.dirname(dirPath)
			}

			count++
		})

		// Capture any error output from ripgrep
		let errorOutput = ""
		rgProcess.stderr.on("data", (data) => {
			errorOutput += data.toString()
		})

		// On Windows the readline 'close' and the child-process 'exit' events
		// fire in non-deterministic order; await both so we can read exitCode
		// before deciding to resolve or reject.
		let resolveOutputClosed!: () => void
		const outputClosed = new Promise<void>((r) => {
			resolveOutputClosed = r
		})
		let resolveExited!: () => void
		const exited = new Promise<void>((r) => {
			resolveExited = r
		})

		rgProcess.on("exit", (code) => {
			exitCode = code
			resolveExited()
		})
		rl.on("close", () => resolveOutputClosed())

		Promise.all([outputClosed, exited]).then(() => {
			// A non-zero exit with results is normal — we proactively SIGTERM
			// after hitting the limit. Only reject when we have nothing to return.
			if (fileResults.length === 0 && (errorOutput || (exitCode !== null && exitCode !== 0))) {
				reject(
					new RipgrepError(
						errorOutput
							? `ripgrep exited with code ${exitCode}: ${errorOutput.trim()}`
							: `ripgrep exited with code ${exitCode}`,
						{ stderr: errorOutput.trim() },
					),
				)
				return
			}

			const dirResults = Array.from(dirSet, (dirPath): { path: string; type: "folder"; label?: string } => ({
				path: dirPath,
				type: "folder",
				label: path.basename(dirPath),
			}))
			resolve([...fileResults, ...dirResults])
		})

		rgProcess.on("error", (error) => {
			reject(new RipgrepError(`ripgrep failed to spawn: ${error.message}`))
		})
	})
}

// Get currently active/open files from VSCode tabs using hostbridge
async function getActiveFiles(): Promise<Set<string>> {
	const request = GetOpenTabsRequest.create({})
	const response = await HostProvider.window.getOpenTabs(request)
	return new Set(response.paths)
}

// Maximum number of candidates to ask the host for. The result is filtered &
// ranked by fzf in core, so we want a comfortably wider net than `limit`.
const HOST_INDEX_CANDIDATE_LIMIT = 5000

// gRPC status code 12 — the standalone host returns this when the RPC isn't
// registered (the in-process VS Code stub throws a plain Error, matched on
// message instead). Treat both as silent steady-state, not failure.
const GRPC_STATUS_UNIMPLEMENTED = 12

/**
 * Returns candidates from the host's native index, or `null` when the host
 * doesn't implement the RPC / the index is unavailable. Returning `[]` is
 * authoritative — caller does not fall back to ripgrep.
 */
async function executeHostIndexForFiles(
	query: string,
	workspacePath: string,
	selectedType?: "file" | "folder",
): Promise<{ path: string; type: "file" | "folder"; label?: string }[] | null> {
	try {
		const req = SearchWorkspaceItemsRequest.create({
			query,
			workspacePath,
			limit: HOST_INDEX_CANDIDATE_LIMIT,
			selectedType:
				selectedType === "file"
					? SearchWorkspaceItemsRequest_SearchItemType.FILE
					: selectedType === "folder"
						? SearchWorkspaceItemsRequest_SearchItemType.FOLDER
						: undefined,
		})
		const resp = await HostProvider.workspace.searchWorkspaceItems(req)

		// Pre-pass: collect host-provided folder paths so the parent-walk below
		// doesn't re-add them as inferred parents and double-list them.
		const folderPaths = new Set<string>()
		for (const item of resp.items) {
			if (item.type === SearchWorkspaceItemsRequest_SearchItemType.FOLDER) {
				folderPaths.add(item.path)
			}
		}

		const fileResults: { path: string; type: "file" | "folder"; label?: string }[] = []
		const dirSet = new Set<string>()
		for (const item of resp.items) {
			const isFolder = item.type === SearchWorkspaceItemsRequest_SearchItemType.FOLDER
			fileResults.push({
				path: item.path,
				type: isFolder ? "folder" : "file",
				label: item.label || path.basename(item.path),
			})
			if (!isFolder) {
				let dirPath = path.dirname(item.path)
				while (dirPath && dirPath !== "." && dirPath !== "/") {
					if (!folderPaths.has(dirPath)) {
						dirSet.add(dirPath)
					}
					dirPath = path.dirname(dirPath)
				}
			}
		}
		const dirResults = Array.from(dirSet, (dirPath): { path: string; type: "folder"; label?: string } => ({
			path: dirPath,
			type: "folder",
			label: path.basename(dirPath),
		}))
		return [...fileResults, ...dirResults]
	} catch (err) {
		// "Unimplemented" is the steady state on VS Code/CLI/ACP — every
		// keystroke trips it — so log at debug to keep the noise floor flat.
		// Anything else (UNAVAILABLE during indexing, INTERNAL, transport
		// errors) is a real degradation we want visible to operators, since
		// the caller is about to silently fall back to a much slower path.
		const code = (err as { code?: unknown } | null)?.code
		const msg = (err as { message?: string } | null)?.message ?? ""
		const isUnimplemented = code === GRPC_STATUS_UNIMPLEMENTED || /not implemented/i.test(msg)
		if (isUnimplemented) {
			Logger.debug("[file-search] host index unimplemented, using ripgrep")
		} else {
			Logger.warn(`[file-search] host index call failed (code=${String(code)}), falling back to ripgrep: ${msg}`)
		}
		return null
	}
}

export type SearchWorkspaceFilesResult = {
	items: { path: string; type: "file" | "folder"; label?: string; workspaceName?: string }[]
	source: FileSearchSource
}

export async function searchWorkspaceFiles(
	query: string,
	workspacePath: string,
	limit = 20,
	selectedType?: "file" | "folder",
	workspaceName?: string,
): Promise<SearchWorkspaceFilesResult> {
	try {
		// Get currently active files and convert to search format
		const activeFilePaths = await getActiveFiles()
		const activeFiles: { path: string; type: "file" | "folder"; label?: string }[] = []

		for (const filePath of activeFilePaths) {
			if (filePath.startsWith(workspacePath + path.sep) || filePath.startsWith(workspacePath + "/")) {
				const relativePath = path.relative(workspacePath, filePath)
				const normalizedPath = relativePath.replace(/\\/g, "/")
				activeFiles.push({
					path: normalizedPath,
					type: "file",
					label: path.basename(normalizedPath),
				})
			}
		}

		const hostItems = await executeHostIndexForFiles(query, workspacePath, selectedType)

		const allItems = hostItems ?? (await executeRipgrepForFiles(workspacePath, 5000))
		const source: FileSearchSource = hostItems ? "host_index" : "ripgrep"

		// Combine active files with all items, removing duplicates (like the old WorkspaceTracker)
		const combinedItems = [...activeFiles]
		for (const item of allItems) {
			if (!activeFiles.some((activeFile) => activeFile.path === item.path)) {
				combinedItems.push(item)
			}
		}

		// If no query, return the combined items
		if (!query.trim()) {
			const addWorkspaceName = (items: typeof combinedItems) =>
				workspaceName ? items.map((item) => ({ ...item, workspaceName })) : items

			let items: SearchWorkspaceFilesResult["items"]
			if (selectedType === "file") {
				items = addWorkspaceName(combinedItems.filter((item) => item.type === "file").slice(0, limit))
			} else if (selectedType === "folder") {
				items = addWorkspaceName(combinedItems.filter((item) => item.type === "folder").slice(0, limit))
			} else {
				items = addWorkspaceName(combinedItems.slice(0, limit))
			}
			return { items, source }
		}

		// Match Scoring - Prioritize the label (filename) by including it twice in the search string
		// Use multiple tiebreakers in order of importance: Match score, then length of match (shorter=better)
		// Get more (2x) results than needed for filtering, we pick the top half after sorting
		const fzfModule = await import("fzf")
		const fzf = new fzfModule.Fzf(combinedItems, {
			selector: (item: { label?: string; path: string }) => `${item.label || ""} ${item.label || ""} ${item.path}`,
			tiebreakers: [OrderbyMatchScore, fzfModule.byLengthAsc],
			limit: limit * 2,
		})

		const filteredResults = fzf.find(query).slice(0, limit)

		// Verify if the path exists and is actually a directory
		const verifiedResultsPromises = filteredResults.map(
			async ({ item }: { item: { path: string; type: "file" | "folder"; label?: string } }) => {
				const fullPath = path.join(workspacePath, item.path)
				let type = item.type

				try {
					const stats = await fs.promises.lstat(fullPath)
					type = stats.isDirectory() ? "folder" : "file"
				} catch {
					// Keep original type if path doesn't exist
				}

				return workspaceName ? { ...item, type, workspaceName } : { ...item, type }
			},
		)

		const items = await Promise.all(verifiedResultsPromises)
		return { items, source }
	} catch (error) {
		// Re-throw so the controller can attach a structured error_reason.
		Logger.error("Error in searchWorkspaceFiles:", error)
		throw error
	}
}

// Custom match scoring for results ordering
// Candidate score tiebreaker - fewer gaps between matched characters scores higher
export const OrderbyMatchScore = (a: FzfResultItem<any>, b: FzfResultItem<any>) => {
	const countGaps = (positions: Iterable<number>) => {
		let gaps = 0,
			prev = Number.NEGATIVE_INFINITY
		for (const pos of positions) {
			if (prev !== Number.NEGATIVE_INFINITY && pos - prev > 1) {
				gaps++
			}
			prev = pos
		}
		return gaps
	}

	return countGaps(a.positions) - countGaps(b.positions)
}

/**
 * Search for files across multiple workspace roots or a specific workspace
 * Similar to searchWorkspaceFiles but supports multiroot workspaces
 */
export async function searchWorkspaceFilesMultiroot(
	query: string,
	workspaceManager: WorkspaceRootManager,
	limit = 20,
	selectedType?: "file" | "folder",
	workspaceHint?: string,
): Promise<SearchWorkspaceFilesResult> {
	try {
		const workspaceRoots = workspaceManager?.getRoots?.() || []

		if (workspaceRoots.length === 0) {
			return { items: [], source: "ripgrep" }
		}

		let workspacesToSearch: WorkspaceRoot[] = []

		// Search only the user-specified workspace (Ex input: @frontend:/query)
		if (workspaceHint) {
			const targetWorkspace = workspaceRoots.find((root: WorkspaceRoot) => root.name === workspaceHint)
			if (targetWorkspace) {
				workspacesToSearch = [targetWorkspace]
			} else {
				return { items: [], source: "ripgrep" }
			}
		} else {
			// Search all workspaces if no hint provided
			workspacesToSearch = workspaceRoots
		}

		// In a true multi-root search, swallow per-root errors so a single broken
		// root doesn't kill the rest; we still re-throw below if *every* root
		// failed. In single-root mode the throw propagates up unchanged.
		let firstError: unknown
		const searchPromises = workspacesToSearch.map(async (workspace): Promise<SearchWorkspaceFilesResult> => {
			try {
				return await searchWorkspaceFiles(query, workspace.path, limit, selectedType, workspace.name)
			} catch (error) {
				if (!firstError) {
					firstError = error
				}
				Logger.error(`[searchWorkspaceFilesMultiroot] Error searching workspace ${workspace.name}:`, error)
				return { items: [], source: "ripgrep" }
			}
		})

		// Aggregate per-root results. The combined `source` is `host_index`
		// only if every contributing root reported `host_index`; if any root
		// fell back to ripgrep we report `ripgrep` so telemetry isn't misleading.
		const allResults = await Promise.all(searchPromises)
		let flatResults: SearchWorkspaceFilesResult["items"] = allResults.flatMap((r) => r.items)
		const aggregateSource: FileSearchSource =
			allResults.length > 0 && allResults.every((r) => r.source === "host_index") ? "host_index" : "ripgrep"
		if (workspacesToSearch.length > 1) {
			const pathCounts = new Map<string, number>()
			for (const result of flatResults) {
				pathCounts.set(result.path, (pathCounts.get(result.path) || 0) + 1)
			}

			flatResults = flatResults.map((result) => {
				if (pathCounts.get(result.path)! > 1 && result.workspaceName) {
					return {
						...result,
						label: `${result.workspaceName}:/${result.path}`,
					}
				}
				return result
			})
		}

		// Apply fuzzy matching across all results if needed
		if (query.trim() && flatResults.length > limit) {
			const fzfModule = await import("fzf")
			const fzf = new fzfModule.Fzf(flatResults, {
				selector: (item: { label?: string; path: string }) => `${item.label || ""} ${item.label || ""} ${item.path}`,
				tiebreakers: [OrderbyMatchScore, fzfModule.byLengthAsc],
			})
			flatResults = fzf
				.find(query)
				.slice(0, limit)
				.map((result) => result.item)
		} else {
			flatResults = flatResults.slice(0, limit)
		}

		if (firstError && flatResults.length === 0) {
			throw firstError
		}

		return { items: flatResults, source: aggregateSource }
	} catch (error) {
		Logger.error("[searchWorkspaceFilesMultiroot] Error in multiroot search:", error)
		throw error
	}
}
