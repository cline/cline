/**
 * WorkspaceRootManager - Central manager for multi-workspace operations
 * This class handles workspace root resolution, path mapping, and workspace context
 */

import { execa } from "execa"
import * as path from "path"
import { getLatestGitCommitHash } from "../../utils/git"
import { VcsType, WorkspaceRoot } from "./WorkspaceRoot"

export interface WorkspaceContext {
	workspaceRoots: WorkspaceRoot[]
	primaryRoot: WorkspaceRoot
	currentRoot?: WorkspaceRoot
}

export class WorkspaceRootManager {
	private roots: WorkspaceRoot[] = []
	private primaryIndex: number = 0

	constructor(roots: WorkspaceRoot[] = [], primaryIndex: number = 0) {
		this.roots = roots
		this.primaryIndex = Math.min(primaryIndex, Math.max(0, roots.length - 1))
	}

	/**
	 * Initialize from a single cwd for backward compatibility
	 */
	static async fromLegacyCwd(cwd: string): Promise<WorkspaceRootManager> {
		const vcs = await WorkspaceRootManager.detectVcs(cwd)
		const gitHash = vcs === VcsType.Git ? await getLatestGitCommitHash(cwd) : null
		const commitHash = gitHash === null ? undefined : gitHash

		const root: WorkspaceRoot = {
			path: cwd,
			name: path.basename(cwd),
			vcs,
			commitHash,
		}

		return new WorkspaceRootManager([root], 0)
	}

	/**
	 * Detect version control system for a directory
	 */
	private static async detectVcs(dirPath: string): Promise<VcsType> {
		try {
			// Check for Git
			await execa("git", ["rev-parse", "--git-dir"], { cwd: dirPath })
			return VcsType.Git
		} catch {
			// Not a git repo
		}

		try {
			// Check for Mercurial
			await execa("hg", ["root"], { cwd: dirPath })
			return VcsType.Mercurial
		} catch {
			// Not a mercurial repo
		}

		return VcsType.None
	}

	/**
	 * Add a new workspace root
	 */
	async addRoot(rootPath: string, name?: string): Promise<void> {
		const vcs = await WorkspaceRootManager.detectVcs(rootPath)
		const gitHash = vcs === VcsType.Git ? await getLatestGitCommitHash(rootPath) : null
		const commitHash = gitHash === null ? undefined : gitHash

		const root: WorkspaceRoot = {
			path: rootPath,
			name: name || path.basename(rootPath),
			vcs,
			commitHash,
		}

		this.roots.push(root)
	}

	/**
	 * Remove a workspace root by path
	 */
	removeRoot(path: string): boolean {
		const index = this.roots.findIndex((r) => r.path === path)
		if (index === -1) {
			return false
		}

		this.roots.splice(index, 1)

		// Adjust primary index if needed
		if (this.primaryIndex >= this.roots.length) {
			this.primaryIndex = Math.max(0, this.roots.length - 1)
		}

		return true
	}

	/**
	 * Get all workspace roots
	 */
	getRoots(): WorkspaceRoot[] {
		return [...this.roots]
	}

	/**
	 * Get the primary workspace root
	 */
	getPrimaryRoot(): WorkspaceRoot | undefined {
		return this.roots[this.primaryIndex]
	}

	/**
	 * Set the primary workspace root by index
	 */
	setPrimaryIndex(index: number): void {
		if (index >= 0 && index < this.roots.length) {
			this.primaryIndex = index
		}
	}

	/**
	 * Find the workspace root that contains the given absolute path
	 */
	resolvePathToRoot(absolutePath: string): WorkspaceRoot | undefined {
		// Sort roots by path length (longest first) to handle nested workspaces
		const sortedRoots = [...this.roots].sort((a, b) => b.path.length - a.path.length)

		for (const root of sortedRoots) {
			if (absolutePath.startsWith(root.path)) {
				return root
			}
		}

		return undefined
	}

	/**
	 * Find workspace root by name
	 */
	getRootByName(name: string): WorkspaceRoot | undefined {
		return this.roots.find((r) => r.name === name)
	}

	/**
	 * Get workspace root by index
	 */
	getRootByIndex(index: number): WorkspaceRoot | undefined {
		return this.roots[index]
	}

	/**
	 * Check if a path is within any workspace root
	 */
	isPathInWorkspace(absolutePath: string): boolean {
		return this.resolvePathToRoot(absolutePath) !== undefined
	}

	/**
	 * Get relative path from workspace root
	 */
	getRelativePathFromRoot(absolutePath: string, root?: WorkspaceRoot): string | undefined {
		const targetRoot = root || this.resolvePathToRoot(absolutePath)
		if (!targetRoot) {
			return undefined
		}

		return path.relative(targetRoot.path, absolutePath)
	}

	/**
	 * Create workspace context for tool execution
	 */
	createContext(currentRoot?: WorkspaceRoot): WorkspaceContext {
		return {
			workspaceRoots: this.getRoots(),
			primaryRoot: this.getPrimaryRoot()!,
			currentRoot: currentRoot || this.getPrimaryRoot(),
		}
	}

	/**
	 * Serialize for storage
	 */
	toJSON(): { roots: WorkspaceRoot[]; primaryIndex: number } {
		return {
			roots: this.roots,
			primaryIndex: this.primaryIndex,
		}
	}

	/**
	 * Deserialize from storage
	 */
	static fromJSON(data: { roots: WorkspaceRoot[]; primaryIndex: number }): WorkspaceRootManager {
		return new WorkspaceRootManager(data.roots, data.primaryIndex)
	}

	/**
	 * Get a summary string for display
	 */
	getSummary(): string {
		if (this.roots.length === 0) {
			return "No workspace roots configured"
		}

		if (this.roots.length === 1) {
			return `Single workspace: ${this.roots[0].name || this.roots[0].path}`
		}

		const primary = this.getPrimaryRoot()
		return `Multi-workspace (${this.roots.length} roots)\nPrimary: ${primary?.name || primary?.path}\nAdditional: ${this.roots
			.filter((_, i) => i !== this.primaryIndex)
			.map((r) => r.name || path.basename(r.path))
			.join(", ")}`
	}

	/**
	 * Check if this is a single-root workspace (for backward compatibility)
	 */
	isSingleRoot(): boolean {
		return this.roots.length === 1
	}

	/**
	 * Get the single root if this is a single-root workspace
	 * Throws if multiple roots exist
	 */
	getSingleRoot(): WorkspaceRoot {
		if (this.roots.length !== 1) {
			throw new Error(`Expected single root, but found ${this.roots.length} roots`)
		}
		return this.roots[0]
	}

	/**
	 * Update commit hashes for all Git repositories
	 */
	async updateCommitHashes(): Promise<void> {
		for (const root of this.roots) {
			if (root.vcs === VcsType.Git) {
				const gitHash = await getLatestGitCommitHash(root.path)
				root.commitHash = gitHash === null ? undefined : gitHash
			}
		}
	}
}

// Export for use in Task and Controller
export function createLegacyWorkspaceRoot(cwd: string): WorkspaceRoot {
	return {
		path: cwd,
		name: path.basename(cwd),
		vcs: VcsType.None, // Will be detected properly during initialization
	}
}
