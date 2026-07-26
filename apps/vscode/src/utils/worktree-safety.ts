import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import simpleGit from "simple-git"
import { getGitRootPath, listWorktrees } from "./git-worktree"

export type WorktreeMutation = "create" | "delete" | "merge"

export interface WorktreeOperationInspection {
	allowed: boolean
	reason?: string
	operation: WorktreeMutation
	repositoryRoot: string
	currentWorkspace: string
	managedRoot: string
	worktreePath: string
	branch?: string
	baseBranch?: string
	targetBranch?: string
	gitOperation: string[]
	dirty: boolean
	untrackedFiles: string[]
	affectedTaskId?: string
	affectedAgentId?: string
}

export interface InspectWorktreeMutationInput {
	operation: WorktreeMutation
	worktreePath: string
	branch?: string
	baseBranch?: string
	targetBranch?: string
	allowDirty?: boolean
	affectedTaskId?: string
	affectedAgentId?: string
	createNewBranch?: boolean
}

function normalizeForComparison(value: string): string {
	const normalized = path.resolve(value)
	return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function isWithin(parent: string, child: string): boolean {
	const relative = path.relative(parent, child)
	return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

export function getManagedWorktreeRoot(repositoryRoot: string): string {
	const digest = createHash("sha256").update(normalizeForComparison(repositoryRoot)).digest("hex").slice(0, 10)
	const repoName = path.basename(repositoryRoot).replace(/[^a-zA-Z0-9._-]+/g, "-") || "repository"
	return path.join(homedir(), ".cline", "data", "worktrees", `${repoName}-${digest}`)
}

export async function inspectWorktreeMutation(
	cwd: string,
	input: InspectWorktreeMutationInput,
): Promise<WorktreeOperationInspection> {
	const repositoryRoot = path.resolve((await getGitRootPath(cwd)) ?? cwd)
	const currentWorkspace = path.resolve(cwd)
	const managedRoot = getManagedWorktreeRoot(repositoryRoot)
	const worktreePath = path.resolve(input.worktreePath)
	const { worktrees } = await listWorktrees(repositoryRoot)
	const recognized = worktrees.find(
		(worktree) => normalizeForComparison(worktree.path) === normalizeForComparison(worktreePath),
	)
	const status = recognized
		? await simpleGit(recognized.path)
				.status()
				.catch(() => undefined)
		: undefined
	const dirty = status ? !status.isClean() : false
	const untrackedFiles = status?.not_added ?? []
	const base = {
		operation: input.operation,
		repositoryRoot,
		currentWorkspace,
		managedRoot,
		worktreePath,
		branch: input.branch ?? recognized?.branch,
		baseBranch: input.baseBranch,
		targetBranch: input.targetBranch,
		dirty,
		untrackedFiles,
		affectedTaskId: input.affectedTaskId,
		affectedAgentId: input.affectedAgentId,
	}

	if (input.operation === "create") {
		const gitOperation = input.branch
			? input.createNewBranch
				? input.baseBranch
					? ["git", "worktree", "add", "-b", input.branch, worktreePath, input.baseBranch]
					: ["git", "worktree", "add", "-b", input.branch, worktreePath]
				: ["git", "worktree", "add", worktreePath, input.branch]
			: ["git", "worktree", "add", "--detach", worktreePath]
		if (!isWithin(managedRoot, worktreePath)) {
			return {
				...base,
				allowed: false,
				reason: `Managed worktrees must be created under ${managedRoot}`,
				gitOperation,
			}
		}
		if (recognized) {
			return { ...base, allowed: false, reason: "That worktree already exists", gitOperation }
		}
		if (existsSync(worktreePath)) {
			return {
				...base,
				allowed: false,
				reason: "The target path already exists and will not be overwritten",
				gitOperation,
			}
		}
		if (input.branch?.startsWith("-") || input.baseBranch?.startsWith("-")) {
			return { ...base, allowed: false, reason: "Branch names cannot begin with '-'", gitOperation }
		}
		return { ...base, allowed: true, gitOperation }
	}

	const targetWorktree =
		input.operation === "merge" ? worktrees.find((worktree) => worktree.branch === input.targetBranch) : undefined
	const gitOperation =
		input.operation === "delete"
			? input.allowDirty
				? ["git", "worktree", "remove", "--force", worktreePath]
				: ["git", "worktree", "remove", worktreePath]
			: targetWorktree
				? ["git", "-C", targetWorktree.path, "merge", recognized?.branch ?? input.branch ?? "", "--no-edit"]
				: ["git", "merge", recognized?.branch ?? input.branch ?? "", "--no-edit"]
	if (!recognized) {
		return { ...base, allowed: false, reason: "The target is not a recognized repository worktree", gitOperation }
	}
	if (!status) {
		return {
			...base,
			allowed: false,
			reason: "The worktree status could not be inspected; retry after resolving Git or file-lock errors",
			gitOperation,
		}
	}
	if (
		normalizeForComparison(worktreePath) === normalizeForComparison(repositoryRoot) ||
		normalizeForComparison(worktreePath) === normalizeForComparison(currentWorkspace) ||
		recognized.isCurrent
	) {
		return {
			...base,
			allowed: false,
			reason: "The repository root or current workspace cannot be removed or mutated from this action",
			gitOperation,
		}
	}
	if (!isWithin(managedRoot, worktreePath)) {
		return {
			...base,
			allowed: false,
			reason: `Only recognized worktrees under ${managedRoot} are managed by Cline`,
			gitOperation,
		}
	}
	if (input.operation === "delete" && input.branch && input.branch !== recognized.branch) {
		return {
			...base,
			allowed: false,
			reason: `Requested branch '${input.branch}' does not match worktree branch '${recognized.branch}'`,
			gitOperation,
		}
	}
	if (dirty && !input.allowDirty) {
		return {
			...base,
			allowed: false,
			reason: "The worktree has dirty or untracked changes; make a separate explicit dirty-worktree decision",
			gitOperation,
		}
	}
	if (input.operation === "merge") {
		if (!targetWorktree) {
			return {
				...base,
				allowed: false,
				reason: `Target branch '${input.targetBranch ?? ""}' is not checked out in a recognized worktree`,
				gitOperation,
			}
		}
		if (targetWorktree.branch === recognized.branch) {
			return {
				...base,
				allowed: false,
				reason: "A worktree branch cannot be merged into itself",
				gitOperation,
			}
		}
		const targetStatus = await simpleGit(targetWorktree.path)
			.status()
			.catch(() => undefined)
		if (!targetStatus) {
			return {
				...base,
				allowed: false,
				reason: "The target worktree status could not be inspected; retry after resolving Git or file-lock errors",
				gitOperation,
			}
		}
		if (!targetStatus.isClean()) {
			return {
				...base,
				allowed: false,
				reason: `Target worktree '${targetWorktree.path}' has dirty or untracked changes`,
				gitOperation,
			}
		}
	}
	return { ...base, allowed: true, gitOperation }
}
