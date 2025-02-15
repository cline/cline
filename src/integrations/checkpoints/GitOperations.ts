import simpleGit, { SimpleGit } from "simple-git"
import { getLfsPatterns, writeExcludesFile } from "./CheckpointExclusions"
import fs from "fs/promises"
import * as path from "path"
import { fileExistsAtPath } from "../../utils/fs"
import * as vscode from "vscode"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { getWorkingDirectory, hashWorkingDir } from "./CheckpointUtils"
import { HistoryItem } from "../../shared/HistoryItem"

/**
 * GitOperations Class
 *
 * Handles git-specific operations for Cline's Checkpoints system.
 * This class encapsulates git operations to provide a clean separation
 * of concerns from checkpoint tracking logic.
 *
 * Key responsibilities:
 * - Git repository initialization and configuration
 * - Git settings management (user, LFS, etc.)
 * - Worktree configuration
 */
export class GitOperations {
    private cwd: string
    private isLegacyCheckpoint: boolean

    /**
     * Creates a new GitOperations instance.
     *
     * @param cwd - The current working directory for git operations
     * @param isLegacyCheckpoint - Whether this is operating in legacy checkpoint mode
     */
    constructor(cwd: string, isLegacyCheckpoint: boolean) {
        this.cwd = cwd
        this.isLegacyCheckpoint = isLegacyCheckpoint
    }

    /**
     * Initializes or verifies a shadow Git repository for checkpoint tracking.
     * Creates a new repository if one doesn't exist, or verifies the worktree
     * configuration if it does.
     *
     * Key operations:
     * - Creates/verifies shadow git repository
     * - Configures git settings (user, LFS, etc.)
     * - Sets up worktree to point to workspace
     * - Creates initial empty commit
     * - Handles both legacy and new checkpoint structures
     *
     * Legacy path structure:
     * globalStorage/
     *   tasks/
     *     {taskId}/
     *       checkpoints/
     *         .git/
     *
     * Branch-per-task path structure:
     * globalStorage/
     *   checkpoints/
     *     {cwdHash}/
     *       .git/
     *
     * Git Configuration:
     * - core.worktree: Set to workspace directory
     * - commit.gpgSign: Disabled
     * - user.name: "Cline Checkpoint"
     * - user.email: "checkpoint@cline.bot"
     *
     * @param gitPath - Path to the .git directory
     * @returns Promise<string> Path to the initialized .git directory
     * @throws Error if:
     * - Worktree verification fails for existing repository
     * - Git initialization or configuration fails
     * - Unable to create initial commit
     * - LFS pattern setup fails
     */
    public async initShadowGit(gitPath: string): Promise<string> {
        console.log(`Initializing ${this.isLegacyCheckpoint ? "legacy" : "new"} shadow git`)

        // If repo exists, just verify worktree
        if (await this.fileExists(gitPath)) {
            const git = simpleGit(path.dirname(gitPath))
            const worktree = await git.getConfig("core.worktree")
            if (worktree.value !== this.cwd) {
                throw new Error("Checkpoints can only be used in the original workspace: " + worktree.value)
            }
            console.log(`Using existing ${this.isLegacyCheckpoint ? "legacy" : "new"} shadow git at ${gitPath}`)
            return gitPath
        }

        // Initialize new repo
        const checkpointsDir = path.dirname(gitPath)
        console.log(`Creating new ${this.isLegacyCheckpoint ? "legacy" : "new"} shadow git in ${checkpointsDir}`)

        const git = simpleGit(checkpointsDir)
        await git.init()

        // Configure repo
        await git.addConfig("core.worktree", this.cwd)
        await git.addConfig("commit.gpgSign", "false")
        await git.addConfig("user.name", "Cline Checkpoint")
        await git.addConfig("user.email", "checkpoint@cline.bot")

        // Set up LFS patterns
        const lfsPatterns = await getLfsPatterns(this.cwd)
        await writeExcludesFile(gitPath, lfsPatterns)

        // Initial commit only on first repo creation
        await git.commit("initial commit", { "--allow-empty": null })

        console.log(`${this.isLegacyCheckpoint ? "Legacy" : "New"} shadow git initialization completed`)

        return gitPath
    }

    /**
     * Retrieves the worktree path from the shadow git configuration.
     * The worktree path indicates where the shadow git repository is tracking files,
     * which should match the current workspace directory.
     */
    public async getShadowGitConfigWorkTree(gitPath: string): Promise<string | undefined> {
        try {
            const git = simpleGit(path.dirname(gitPath))
            const worktree = await git.getConfig("core.worktree")
            return worktree.value || undefined
        } catch (error) {
            console.error("Failed to get shadow git config worktree:", error)
            return undefined
        }
    }

    /**
     * Helper method to check if a file exists at the given path.
     *
     * @param path - Path to check for file existence
     * @returns Promise<boolean> True if file exists, false otherwise
     */
    private async fileExists(path: string): Promise<boolean> {
        try {
            await fs.access(path)
            return true
        } catch {
            return false
        }
    }

    /**
     * Checks if a shadow Git repository exists for the given task and workspace.
     */
    public static async doesShadowGitExist(taskId: string, provider?: ClineProvider): Promise<boolean> {
        const globalStoragePath = provider?.context.globalStorageUri.fsPath
        if (!globalStoragePath) {
            return false
        }

        // Check legacy checkpoint path to see if this is a legacy task
        const legacyGitPath = path.join(globalStoragePath, "tasks", taskId, "checkpoints", ".git")
        if (await fileExistsAtPath(legacyGitPath)) {
            console.log("Found legacy shadow git")
            return true
        }

        // Check branch-per-task path for newer tasks
        const workingDir = await getWorkingDirectory()
        const cwdHash = hashWorkingDir(workingDir)
        const gitPath = path.join(globalStoragePath, "checkpoints", cwdHash, ".git")
        const exists = await fileExistsAtPath(gitPath)
        if (exists) {
            console.log("Found new shadow git")
        }
        return exists
    }

    /**
     * Deletes a branch in the git repository, handling cases where the branch is currently checked out.
     * @param git - SimpleGit instance to use for operations
     * @param branchName - Name of the branch to delete
     * @param checkpointsDir - Directory containing the git repository
     * @throws Error if branch deletion fails
     */
    public static async deleteBranchForGit(git: SimpleGit, branchName: string, checkpointsDir: string): Promise<void> {
        // Check if branch exists
        const branches = await git.branchLocal()
        if (!branches.all.includes(branchName)) {
            console.log(`Task branch ${branchName} does not exist, nothing to delete`)
            return // Branch doesn't exist, nothing to delete
        }

        // First, if we're on the branch to be deleted, switch to master
        const currentBranch = await git.revparse(["--abbrev-ref", "HEAD"])
        console.log(`Current branch: ${currentBranch}, target branch to delete: ${branchName}`)

        if (currentBranch === branchName) {
            console.log("Currently on branch to be deleted, switching to master first")
            // Save the current worktree config
            const worktree = await git.getConfig("core.worktree")
            console.log(`Saved current worktree config: ${worktree.value}`)

            try {
                // Temporarily unset worktree to prevent workspace modifications
                console.log("Temporarily unsetting worktree config")
                await git.raw(["config", "--unset", "core.worktree"])

                // Force discard all changes
                console.log("Discarding all changes")
                await git.reset(["--hard"])
                await git.clean('f', ['-d']) // Clean mode 'f' for force, -d for directories

                // Switch to master and delete branch
                console.log("Attempting to force switch to master branch")
                await git.checkout(["master", "--force"])

                // Verify the switch completed
                let retries = 3
                while (retries > 0) {
                    const newBranch = await git.revparse(["--abbrev-ref", "HEAD"])
                    console.log(`Verifying branch switch - current branch: ${newBranch}, attempts left: ${retries}`)
                    if (newBranch === "master") {
                        console.log("Successfully switched to master branch")
                        break
                    }
                    retries--
                    if (retries === 0) {
                        throw new Error("Failed to switch to master branch")
                    }
                }

                console.log(`Deleting branch: ${branchName}`)
                await git.raw(["branch", "-D", branchName])
                console.log(`Successfully deleted branch: ${branchName}`)
            } finally {
                // Restore the worktree config
                if (worktree.value) {
                    console.log(`Restoring worktree config to: ${worktree.value}`)
                    await git.addConfig("core.worktree", worktree.value)
                }
            }
        } else {
            // If we're not on the branch, we can safely delete it
            console.log(`Directly deleting branch ${branchName} since we're not on it`)
            await git.raw(["branch", "-D", branchName])
            console.log(`Successfully deleted branch: ${branchName}`)
        }
    }

    /**
     * Deletes the branch associated with a task.
     * @param taskId - The ID of the task whose branch should be deleted
     * @param isLegacy - Whether this is a legacy checkpoint
     * @param checkpointsDir - Directory containing the git repository
     * @throws Error if branch deletion fails
     */
    public async deleteTaskBranch(taskId: string, isLegacy: boolean, checkpointsDir: string): Promise<void> {
        try {
            console.log("Starting task branch deletion process...")

            if (isLegacy) {
                console.log("Deleting legacy checkpoint directory")
                try {
                    await fs.rm(checkpointsDir, { recursive: true, force: true })
                    console.log("Successfully deleted legacy checkpoint directory")
                } catch (error) {
                    console.error("Failed to delete legacy checkpoint directory:", error)
                    throw error
                }
                return
            }

            console.log("Deleting task branch in new checkpoint structure")
            const git = simpleGit(checkpointsDir)
            const branchName = `task-${taskId}`

            await GitOperations.deleteBranchForGit(git, branchName, checkpointsDir)
        } catch (error) {
            console.error("Failed to delete task branch:", error)
            throw new Error(`Failed to delete task branch: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    /**
     * Static method to delete a task's branch using stored workspace path.
     * @param taskId - The ID of the task whose branch should be deleted
     * @param historyItem - The history item containing the shadow git config
     * @param globalStoragePath - Path to VS Code's global storage
     * @throws Error if branch deletion fails
     */
    public static async deleteTaskBranchStatic(
        taskId: string,
        historyItem: HistoryItem,
        globalStoragePath: string
    ): Promise<void> {
        try {
            console.log("Starting static task branch deletion process...")
            console.log("History item:", JSON.stringify(historyItem, null, 2))

            if (!globalStoragePath) {
                throw new Error("Global storage uri is invalid")
            }

            // First check for legacy checkpoint
            const legacyCheckpointsDir = path.join(globalStoragePath, "tasks", taskId, "checkpoints")
            const legacyGitPath = path.join(legacyCheckpointsDir, ".git")

            if (await fileExistsAtPath(legacyGitPath)) {
                console.log("Found legacy checkpoint, deleting directory")
                try {
                    await fs.rm(legacyCheckpointsDir, { recursive: true, force: true })
                    console.log("Successfully deleted legacy checkpoint directory")
                    return
                } catch (error) {
                    console.error("Failed to delete legacy checkpoint directory:", error)
                    throw error
                }
            }

            // No legacy checkpoint found, proceed with new structure
            if (!historyItem.shadowGitConfigWorkTree) {
                // Try to determine working directory from current state
                const workingDir = await getWorkingDirectory()
                console.log(`No shadow git config in history item, using current working directory: ${workingDir}`)

                const cwdHash = hashWorkingDir(workingDir)
                const checkpointsDir = path.join(globalStoragePath, "checkpoints", cwdHash)
                const gitPath = path.join(checkpointsDir, ".git")

                if (await fileExistsAtPath(gitPath)) {
                    console.log(`Found git repository at ${gitPath}`)
                    const git = simpleGit(path.dirname(gitPath))
                    const branchName = `task-${taskId}`
                    await GitOperations.deleteBranchForGit(git, branchName, checkpointsDir)
                    return
                }

                console.log("No shadow git found for current working directory")
                return
            }

            const workingDir = historyItem.shadowGitConfigWorkTree
            const cwdHash = hashWorkingDir(workingDir)
            console.log(`Working directory: ${workingDir}, hash: ${cwdHash}`)

            const checkpointsDir = path.join(globalStoragePath, "checkpoints", cwdHash)
            const gitPath = path.join(checkpointsDir, ".git")

            // Verify the shadow git exists
            if (!(await fileExistsAtPath(gitPath))) {
                console.log(`No shadow git found at path: ${gitPath}`)
                return
            }

            console.log("Deleting task branch in new checkpoint structure")
            const git = simpleGit(path.dirname(gitPath))
            const branchName = `task-${taskId}`

            await GitOperations.deleteBranchForGit(git, branchName, checkpointsDir)
        } catch (error) {
            console.error("Failed to delete task branch:", error)
            throw new Error(`Failed to delete task branch: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    /**
     * Since we use git to track checkpoints, we need to temporarily disable nested git repos to work around git's
     * requirement of using submodules for nested repos.
     *
     * This method renames nested .git directories by adding/removing a suffix to temporarily disable/enable them.
     * The root .git directory is preserved.
     *
     * @param disable - If true, adds suffix to disable nested git repos. If false, removes suffix to re-enable them.
     * @throws Error if renaming any .git directory fails
     */
    public async renameNestedGitRepos(disable: boolean): Promise<void> {
        // Find all .git directories that are not at the root level using VS Code API
        const gitFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(this.cwd, "**/.git" + (disable ? "" : GIT_DISABLED_SUFFIX)),
            new vscode.RelativePattern(this.cwd, ".git/**"), // Exclude root .git
        )

        // Filter to only include directories
        const gitPaths: string[] = []
        for (const file of gitFiles) {
            const relativePath = path.relative(this.cwd, file.fsPath)
            try {
                const stats = await fs.stat(path.join(this.cwd, relativePath))
                if (stats.isDirectory()) {
                    gitPaths.push(relativePath)
                }
            } catch {
                // Skip if stat fails
                continue
            }
        }

        // For each nested .git directory, rename it based on the disable flag
        for (const gitPath of gitPaths) {
            const fullPath = path.join(this.cwd, gitPath)
            let newPath: string
            if (disable) {
                newPath = fullPath + GIT_DISABLED_SUFFIX
            } else {
                newPath = fullPath.endsWith(GIT_DISABLED_SUFFIX) ? fullPath.slice(0, -GIT_DISABLED_SUFFIX.length) : fullPath
            }

            try {
                await fs.rename(fullPath, newPath)
                console.log(`${disable ? "Disabled" : "Enabled"} nested git repo ${gitPath}`)
            } catch (error) {
                console.error(`Failed to ${disable ? "disable" : "enable"} nested git repo ${gitPath}:`, error)
            }
        }
    }

    /**
     * Switches to or creates a task-specific branch in the shadow Git repository.
     * For legacy checkpoints, this is a no-op since they use separate repositories.
     * For new checkpoints, this ensures we're on the correct task branch before operations.
     *
     * The method performs the following:
     * 1. Gets the shadow git path and initializes simple-git
     * 2. Constructs the branch name using the task ID
     * 3. Checks if the branch exists:
     *    - If not, creates a new branch
     *    - If yes, switches to the existing branch
     * 4. Verifies the branch switch completed successfully
     *
     * Branch naming convention:
     * task-{taskId}
     *
     * @param taskId - The ID of the task whose branch to switch to
     * @param gitPath - Path to the .git directory
     * @returns Promise<void>
     * @throws Error if branch operations fail or git commands error
     */
    public async switchToTaskBranch(taskId: string, gitPath: string): Promise<void> {
        const git = simpleGit(path.dirname(gitPath))
        const branchName = `task-${taskId}`

        console.log(`Switching to task branch: ${branchName} in shadow git at ${gitPath}`)

        // Create new task-specific branch, or switch to one if it already exists.
        const branches = await git.branchLocal()
        if (!branches.all.includes(branchName)) {
            console.log(`Creating new task branch: ${branchName}`)
            await git.checkoutLocalBranch(branchName)
        } else {
            console.log(`Switching to existing task branch: ${branchName}`)
            await git.checkout(branchName)
        }

        const currentBranch = await git.revparse(["--abbrev-ref", "HEAD"])
        console.log(`Current branch after switch: ${currentBranch}`)
    }
}

export const GIT_DISABLED_SUFFIX = "_disabled"
