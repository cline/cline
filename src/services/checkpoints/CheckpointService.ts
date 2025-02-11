import fs from "fs/promises"
import { existsSync } from "fs"
import path from "path"

import simpleGit, { SimpleGit, CleanOptions } from "simple-git"

export type CheckpointServiceOptions = {
	taskId: string
	git?: SimpleGit
	baseDir: string
	log?: (message: string) => void
}

/**
 * The CheckpointService provides a mechanism for storing a snapshot of the
 * current VSCode workspace each time a Roo Code tool is executed. It uses Git
 * under the hood.
 *
 * HOW IT WORKS
 *
 * Two branches are used:
 *  - A main branch for normal operation (the branch you are currently on).
 *  - A hidden branch for storing checkpoints.
 *
 * Saving a checkpoint:
 *  - A temporary branch is created to store the current state.
 *  - All changes (including untracked files) are staged and committed on the temp branch.
 *  - The hidden branch is reset to match main.
 *  - The temporary branch commit is cherry-picked onto the hidden branch.
 *  - The workspace is restored to its original state and the temp branch is deleted.
 *
 * Restoring a checkpoint:
 *  - The workspace is restored to the state of the specified checkpoint using
 *    `git restore` and `git clean`.
 *
 * This approach allows for:
 *  - Non-destructive version control (main branch remains untouched).
 *  - Preservation of the full history of checkpoints.
 *  - Safe restoration to any previous checkpoint.
 *  - Atomic checkpoint operations with proper error recovery.
 *
 * NOTES
 *
 *  - Git must be installed.
 *  - If the current working directory is not a Git repository, we will
 *    initialize a new one with a .gitkeep file.
 *  - If you manually edit files and then restore a checkpoint, the changes
 *    will be lost. Addressing this adds some complexity to the implementation
 *    and it's not clear whether it's worth it.
 */

export class CheckpointService {
	private static readonly USER_NAME = "Roo Code"
	private static readonly USER_EMAIL = "support@roocode.com"
	private static readonly CHECKPOINT_BRANCH = "roo-code-checkpoints"
	private static readonly STASH_BRANCH = "roo-code-stash"

	private _currentCheckpoint?: string

	public get currentCheckpoint() {
		return this._currentCheckpoint
	}

	private set currentCheckpoint(value: string | undefined) {
		this._currentCheckpoint = value
	}

	constructor(
		public readonly taskId: string,
		private readonly git: SimpleGit,
		public readonly baseDir: string,
		public readonly mainBranch: string,
		public readonly baseCommitHash: string,
		public readonly hiddenBranch: string,
		private readonly log: (message: string) => void,
	) {}

	private async ensureBranch(expectedBranch: string) {
		const branch = await this.git.revparse(["--abbrev-ref", "HEAD"])

		if (branch.trim() !== expectedBranch) {
			throw new Error(`Git branch mismatch: expected '${expectedBranch}' but found '${branch}'`)
		}
	}

	public async getDiff({ from, to }: { from?: string; to: string }) {
		const result = []

		if (!from) {
			from = this.baseCommitHash
		}

		const { files } = await this.git.diffSummary([`${from}..${to}`])

		for (const file of files.filter((f) => !f.binary)) {
			const relPath = file.file
			const absPath = path.join(this.baseDir, relPath)

			// If modified both before and after will generate content.
			// If added only after will generate content.
			// If deleted only before will generate content.
			let beforeContent = ""
			let afterContent = ""

			try {
				beforeContent = await this.git.show([`${from}:${relPath}`])
			} catch (err) {
				// File doesn't exist in older commit.
			}

			try {
				afterContent = await this.git.show([`${to}:${relPath}`])
			} catch (err) {
				// File doesn't exist in newer commit.
			}

			result.push({
				paths: { relative: relPath, absolute: absPath },
				content: { before: beforeContent, after: afterContent },
			})
		}

		return result
	}

	private async restoreMain({
		branch,
		stashSha,
		force = false,
	}: {
		branch: string
		stashSha: string
		force?: boolean
	}) {
		if (force) {
			await this.git.checkout(["-f", this.mainBranch])
		} else {
			await this.git.checkout(this.mainBranch)
		}

		if (stashSha) {
			this.log(`[restoreMain] applying stash ${stashSha}`)
			await this.git.raw(["stash", "apply", "--index", stashSha])
		}

		this.log(`[restoreMain] restoring from ${branch}`)
		await this.git.raw(["restore", "--source", branch, "--worktree", "--", "."])
	}

	public async saveCheckpoint(message: string) {
		await this.ensureBranch(this.mainBranch)

		const stashSha = (await this.git.raw(["stash", "create"])).trim()
		const latestSha = await this.git.revparse([this.hiddenBranch])

		/**
		 * PHASE: Create stash
		 * Mutations:
		 *   - Create branch
		 *   - Change branch
		 */
		const stashBranch = `${CheckpointService.STASH_BRANCH}-${Date.now()}`
		await this.git.checkout(["-b", stashBranch])
		this.log(`[saveCheckpoint] created and checked out ${stashBranch}`)

		/**
		 * Phase: Stage stash
		 * Mutations: None
		 * Recovery:
		 *   - UNDO: Create branch
		 *   - UNDO: Change branch
		 */
		try {
			await this.git.add(["-A"])
			const status = await this.git.status()
			this.log(`[saveCheckpoint] status: ${JSON.stringify(status)}`)
		} catch (err) {
			await this.git.checkout(["-f", this.mainBranch])
			await this.git.branch(["-D", stashBranch]).catch(() => {})

			throw new Error(
				`[saveCheckpoint] Failed in stage stash phase: ${err instanceof Error ? err.message : String(err)}`,
			)
		}

		/**
		 * Phase: Commit stash
		 * Mutations:
		 *   - Commit stash
		 *   - Change branch
		 * Recovery:
		 *   - UNDO: Create branch
		 *   - UNDO: Change branch
		 */
		try {
			// TODO: Add a test to see if empty commits break this.
			const tempCommit = await this.git.commit(message, undefined, { "--no-verify": null })
			this.log(`[saveCheckpoint] tempCommit: ${message} -> ${JSON.stringify(tempCommit)}`)
		} catch (err) {
			await this.git.checkout(["-f", this.mainBranch])
			await this.git.branch(["-D", stashBranch]).catch(() => {})

			throw new Error(
				`[saveCheckpoint] Failed in stash commit phase: ${err instanceof Error ? err.message : String(err)}`,
			)
		}

		/**
		 * PHASE: Diff
		 * Mutations:
		 *   - Checkout hidden branch
		 * Recovery:
		 *   - UNDO: Create branch
		 *   - UNDO: Change branch
		 *   - UNDO: Commit stash
		 */
		let diff

		try {
			diff = await this.git.diff([latestSha, stashBranch])
		} catch (err) {
			await this.restoreMain({ branch: stashBranch, stashSha, force: true })
			await this.git.branch(["-D", stashBranch]).catch(() => {})

			throw new Error(
				`[saveCheckpoint] Failed in diff phase: ${err instanceof Error ? err.message : String(err)}`,
			)
		}

		if (!diff) {
			this.log("[saveCheckpoint] no diff")
			await this.restoreMain({ branch: stashBranch, stashSha })
			await this.git.branch(["-D", stashBranch])
			return undefined
		}

		/**
		 * PHASE: Reset
		 * Mutations:
		 *   - Reset hidden branch
		 * Recovery:
		 *   - UNDO: Create branch
		 *   - UNDO: Change branch
		 *   - UNDO: Commit stash
		 */
		try {
			await this.git.checkout(this.hiddenBranch)
			this.log(`[saveCheckpoint] checked out ${this.hiddenBranch}`)
			await this.git.reset(["--hard", this.mainBranch])
			this.log(`[saveCheckpoint] reset ${this.hiddenBranch}`)
		} catch (err) {
			await this.restoreMain({ branch: stashBranch, stashSha, force: true })
			await this.git.branch(["-D", stashBranch]).catch(() => {})

			throw new Error(
				`[saveCheckpoint] Failed in reset phase: ${err instanceof Error ? err.message : String(err)}`,
			)
		}

		/**
		 * PHASE: Cherry pick
		 * Mutations:
		 *   - Hidden commit (NOTE: reset on hidden branch no longer needed in
		 *     success scenario.)
		 * Recovery:
		 *   - UNDO: Create branch
		 *   - UNDO: Change branch
		 *   - UNDO: Commit stash
		 *   - UNDO: Reset hidden branch
		 */
		let commit = ""

		try {
			try {
				await this.git.raw(["cherry-pick", stashBranch])
			} catch (err) {
				// Check if we're in the middle of a cherry-pick.
				// If the cherry-pick resulted in an empty commit (e.g., only
				// deletions) then complete it with --allow-empty.
				// Otherwise, rethrow the error.
				if (existsSync(path.join(this.baseDir, ".git/CHERRY_PICK_HEAD"))) {
					await this.git.raw(["commit", "--allow-empty", "--no-edit"])
				} else {
					throw err
				}
			}

			commit = await this.git.revparse(["HEAD"])
			this.currentCheckpoint = commit
			this.log(`[saveCheckpoint] cherry-pick commit = ${commit}`)
		} catch (err) {
			await this.git.reset(["--hard", latestSha]).catch(() => {})
			await this.restoreMain({ branch: stashBranch, stashSha, force: true })
			await this.git.branch(["-D", stashBranch]).catch(() => {})

			throw new Error(
				`[saveCheckpoint] Failed in cherry pick phase: ${err instanceof Error ? err.message : String(err)}`,
			)
		}

		await this.restoreMain({ branch: stashBranch, stashSha })
		await this.git.branch(["-D", stashBranch])

		return { commit }
	}

	public async restoreCheckpoint(commitHash: string) {
		await this.ensureBranch(this.mainBranch)
		await this.git.clean([CleanOptions.FORCE, CleanOptions.RECURSIVE])
		await this.git.raw(["restore", "--source", commitHash, "--worktree", "--", "."])
		this.currentCheckpoint = commitHash
	}

	public static async create({ taskId, git, baseDir, log = console.log }: CheckpointServiceOptions) {
		if (process.platform === "win32") {
			throw new Error("Checkpoints are not supported on Windows.")
		}

		git = git || simpleGit({ baseDir })

		const version = await git.version()

		if (!version?.installed) {
			throw new Error(`Git is not installed. Please install Git if you wish to use checkpoints.`)
		}

		if (!baseDir || !existsSync(baseDir)) {
			throw new Error(`Base directory is not set or does not exist.`)
		}

		const { currentBranch, currentSha, hiddenBranch } = await CheckpointService.initRepo({
			taskId,
			git,
			baseDir,
			log,
		})

		log(
			`[CheckpointService] taskId = ${taskId}, baseDir = ${baseDir}, currentBranch = ${currentBranch}, currentSha = ${currentSha}, hiddenBranch = ${hiddenBranch}`,
		)

		return new CheckpointService(taskId, git, baseDir, currentBranch, currentSha, hiddenBranch, log)
	}

	private static async initRepo({ taskId, git, baseDir, log }: Required<CheckpointServiceOptions>) {
		const isExistingRepo = existsSync(path.join(baseDir, ".git"))

		if (!isExistingRepo) {
			await git.init()
			log(`[initRepo] Initialized new Git repository at ${baseDir}`)
		}

		const globalUserName = await git.getConfig("user.name", "global")
		const localUserName = await git.getConfig("user.name", "local")
		const userName = localUserName.value || globalUserName.value

		const globalUserEmail = await git.getConfig("user.email", "global")
		const localUserEmail = await git.getConfig("user.email", "local")
		const userEmail = localUserEmail.value || globalUserEmail.value

		// Prior versions of this service indiscriminately set the local user
		// config, and it should not override the global config. To address
		// this we remove the local user config if it matches the default
		// user name and email and there's a global config.
		if (globalUserName.value && localUserName.value === CheckpointService.USER_NAME) {
			await git.raw(["config", "--unset", "--local", "user.name"])
		}

		if (globalUserEmail.value && localUserEmail.value === CheckpointService.USER_EMAIL) {
			await git.raw(["config", "--unset", "--local", "user.email"])
		}

		// Only set user config if not already configured.
		if (!userName) {
			await git.addConfig("user.name", CheckpointService.USER_NAME)
		}

		if (!userEmail) {
			await git.addConfig("user.email", CheckpointService.USER_EMAIL)
		}

		if (!isExistingRepo) {
			// We need at least one file to commit, otherwise the initial
			// commit will fail, unless we use the `--allow-empty` flag.
			// However, using an empty commit causes problems when restoring
			// the checkpoint (i.e. the `git restore` command doesn't work
			// for empty commits).
			await fs.writeFile(path.join(baseDir, ".gitkeep"), "")
			await git.add(".gitkeep")
			const commit = await git.commit("Initial commit")

			if (!commit.commit) {
				throw new Error("Failed to create initial commit")
			}

			log(`[initRepo] Initial commit: ${commit.commit}`)
		}

		const currentBranch = await git.revparse(["--abbrev-ref", "HEAD"])
		const currentSha = await git.revparse(["HEAD"])

		const hiddenBranch = `${CheckpointService.CHECKPOINT_BRANCH}-${taskId}`
		const branchSummary = await git.branch()

		if (!branchSummary.all.includes(hiddenBranch)) {
			await git.checkoutBranch(hiddenBranch, currentBranch)
			await git.checkout(currentBranch)
		}

		return { currentBranch, currentSha, hiddenBranch }
	}
}
