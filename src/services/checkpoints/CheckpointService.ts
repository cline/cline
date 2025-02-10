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
 *  - Current changes are stashed (including untracked files).
 *  - The hidden branch is reset to match main.
 *  - Stashed changes are applied and committed as a checkpoint on the hidden
 *    branch.
 *  - We return to the main branch with the original state restored.
 *
 * Restoring a checkpoint:
 *  - The workspace is restored to the state of the specified checkpoint using
 *    `git restore` and `git clean`.
 *
 * This approach allows for:
 *  - Non-destructive version control (main branch remains untouched).
 *  - Preservation of the full history of checkpoints.
 *  - Safe restoration to any previous checkpoint.
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

	private async pushStash() {
		const status = await this.git.status()

		if (status.files.length > 0) {
			await this.git.stash(["-u"]) // Includes tracked and untracked files.
			return true
		}

		return false
	}

	private async applyStash() {
		const stashList = await this.git.stashList()

		if (stashList.all.length > 0) {
			await this.git.stash(["apply"]) // Applies the most recent stash only.
			return true
		}

		return false
	}

	private async popStash() {
		const stashList = await this.git.stashList()

		if (stashList.all.length > 0) {
			await this.git.stash(["pop", "--index"]) // Pops the most recent stash only.
			return true
		}

		return false
	}

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

	public async saveCheckpoint(message: string) {
		await this.ensureBranch(this.mainBranch)

		// Attempt to stash pending changes (including untracked files).
		const pendingChanges = await this.pushStash()

		// Get the latest commit on the hidden branch before we reset it.
		const latestHash = await this.git.revparse([this.hiddenBranch])

		// Check if there is any diff relative to the latest commit.
		if (!pendingChanges) {
			const diff = await this.git.diff([latestHash])

			if (!diff) {
				this.log(`[saveCheckpoint] No changes detected, giving up`)
				return undefined
			}
		}

		await this.git.checkout(this.hiddenBranch)

		const reset = async () => {
			await this.git.reset(["HEAD", "."])
			await this.git.clean([CleanOptions.FORCE, CleanOptions.RECURSIVE])
			await this.git.reset(["--hard", latestHash])
			await this.git.checkout(this.mainBranch)
			await this.popStash()
		}

		try {
			// Reset hidden branch to match main and apply the pending changes.
			await this.git.reset(["--hard", this.mainBranch])

			if (pendingChanges) {
				await this.applyStash()
			}

			// Using "-A" ensures that deletions are staged as well.
			await this.git.add(["-A"])
			const diff = await this.git.diff([latestHash])

			if (!diff) {
				this.log(`[saveCheckpoint] No changes detected, resetting and giving up`)
				await reset()
				return undefined
			}

			// Otherwise, commit the changes.
			const status = await this.git.status()
			this.log(`[saveCheckpoint] Changes detected, committing ${JSON.stringify(status)}`)

			// Allow empty commits in order to correctly handle deletion of
			// untracked files (see unit tests for an example of this).
			// Additionally, skip pre-commit hooks so that they don't slow
			// things down or tamper with the contents of the commit.
			const commit = await this.git.commit(message, undefined, {
				"--allow-empty": null,
				"--no-verify": null,
			})

			await this.git.checkout(this.mainBranch)

			if (pendingChanges) {
				await this.popStash()
			}

			this.currentCheckpoint = commit.commit

			return commit
		} catch (err) {
			this.log(`[saveCheckpoint] Failed to save checkpoint: ${err instanceof Error ? err.message : String(err)}`)

			// If we're not on the main branch then we need to trigger a reset
			// to return to the main branch and restore it's previous state.
			const currentBranch = await this.git.revparse(["--abbrev-ref", "HEAD"])

			if (currentBranch.trim() !== this.mainBranch) {
				await reset()
			}

			throw err
		}
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

		const hiddenBranch = `roo-code-checkpoints-${taskId}`
		const branchSummary = await git.branch()

		if (!branchSummary.all.includes(hiddenBranch)) {
			await git.checkoutBranch(hiddenBranch, currentBranch) // git checkout -b <hiddenBranch> <currentBranch>
			await git.checkout(currentBranch) // git checkout <currentBranch>
		}

		return { currentBranch, currentSha, hiddenBranch }
	}
}
