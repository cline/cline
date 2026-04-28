/**
 * RefCheckpointTracker — Git plumbing-based checkpoint tracker for the SDK migration.
 *
 * Uses the user's workspace .git repo directly (no shadow git) with synthetic
 * commits stored under custom refs: refs/cline/checkpoints/<taskId>/turn/<seq>
 *
 * Checkpoints form their own commit chain — each checkpoint's parent is the
 * previous checkpoint commit for that task. The first checkpoint's parent is
 * HEAD at task-start time.
 */

import { execFile } from "node:child_process"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { promisify } from "node:util"
import { isBinaryFile } from "isbinaryfile"
import { Logger } from "@/shared/services/Logger"

const execFileAsync = promisify(execFile)

const GIT_AUTHOR_NAME = "Cline Checkpoints"
const GIT_AUTHOR_EMAIL = "checkpoints@cline.bot"
const MAX_BUFFER = 10 * 1024 * 1024

export class RefCheckpointTracker {
	private readonly taskId: string
	private readonly repoRoot: string
	private sequenceNumber = 0
	private previousCheckpointCommit: string | undefined

	private constructor(taskId: string, repoRoot: string) {
		this.taskId = taskId
		this.repoRoot = repoRoot
	}

	public static async create(
		taskId: string,
		enableCheckpoints: boolean,
		workspaceRoot: string,
	): Promise<RefCheckpointTracker | undefined> {
		if (!enableCheckpoints) {
			Logger.info(`[RefCheckpointTracker] Checkpoints disabled for task ${taskId}`)
			return undefined
		}

		try {
			await execFileAsync("git", ["--version"], { timeout: 5000 })
		} catch {
			Logger.warn("[RefCheckpointTracker] Git not available — checkpoints disabled")
			return undefined
		}

		let repoRoot: string
		try {
			const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
				cwd: workspaceRoot,
				timeout: 5000,
			})
			repoRoot = stdout.trim()
		} catch {
			Logger.info(`[RefCheckpointTracker] Not a git repo: ${workspaceRoot} — skipping`)
			return undefined
		}

		Logger.info(`[RefCheckpointTracker] Created for task ${taskId} in ${repoRoot}`)
		return new RefCheckpointTracker(taskId, repoRoot)
	}

	/**
	 * Create a checkpoint commit capturing the current workspace state.
	 * Uses a temp index file so the user's real index is never modified.
	 */
	public async commit(): Promise<string | undefined> {
		let tempDir: string | undefined

		try {
			const startTime = performance.now()
			tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-cp-"))
			const tempIndex = path.join(tempDir, "index")

			const gitEnv: Record<string, string> = {
				...process.env,
				GIT_INDEX_FILE: tempIndex,
				GIT_AUTHOR_NAME,
				GIT_AUTHOR_EMAIL,
				GIT_COMMITTER_NAME: GIT_AUTHOR_NAME,
				GIT_COMMITTER_EMAIL: GIT_AUTHOR_EMAIL,
			} as Record<string, string>

			// Read source tree into temp index (previous checkpoint or HEAD)
			const readTreeSource = this.previousCheckpointCommit ?? (await this.getHeadCommit())
			if (readTreeSource) {
				await execFileAsync("git", ["read-tree", readTreeSource], {
					cwd: this.repoRoot,
					env: gitEnv,
					maxBuffer: MAX_BUFFER,
				})
			}

			// Stage all working tree files into temp index
			await execFileAsync("git", ["add", "-A", "--", "."], {
				cwd: this.repoRoot,
				env: gitEnv,
				maxBuffer: MAX_BUFFER,
			})

			// Write tree object from temp index
			const { stdout: treeHash } = await execFileAsync("git", ["write-tree"], {
				cwd: this.repoRoot,
				env: gitEnv,
			})
			const tree = treeHash.trim()

			// Create commit-tree with parent
			this.sequenceNumber++
			const message = `checkpoint ${this.taskId} turn ${this.sequenceNumber}`
			const commitArgs = ["commit-tree", tree, "-m", message]

			const parent = this.previousCheckpointCommit ?? (await this.getHeadCommit())
			if (parent) {
				commitArgs.push("-p", parent)
			}

			const { stdout: commitOut } = await execFileAsync("git", commitArgs, {
				cwd: this.repoRoot,
				env: gitEnv,
			})
			const commit = commitOut.trim()

			// Update ref
			const refName = `refs/cline/checkpoints/${this.taskId}/turn/${this.sequenceNumber}`
			await execFileAsync("git", ["update-ref", refName, commit], {
				cwd: this.repoRoot,
			})

			this.previousCheckpointCommit = commit

			const durationMs = Math.round(performance.now() - startTime)
			Logger.info(`[RefCheckpointTracker] Checkpoint #${this.sequenceNumber}: ${commit} (${durationMs}ms)`)
			return commit
		} catch (error) {
			Logger.error("[RefCheckpointTracker] Failed to create checkpoint:", error)
			return undefined
		} finally {
			if (tempDir) {
				await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
			}
		}
	}

	/**
	 * Restore the workspace to a checkpoint's state.
	 * Deletes files created after the checkpoint, then restores all checkpoint files.
	 */
	public async restore(commitHash: string): Promise<void> {
		try {
			const startTime = performance.now()
			const hash = this.cleanCommitHash(commitHash)
			Logger.info(`[RefCheckpointTracker] Restoring to checkpoint: ${hash}`)

			// Find untracked files that wouldn't show in git diff
			const { stdout: untrackedFiles } = await execFileAsync("git", ["ls-files", "--others", "--exclude-standard"], {
				cwd: this.repoRoot,
				maxBuffer: MAX_BUFFER,
			}).catch(() => ({ stdout: "" }))

			// Delete untracked files that don't exist in the checkpoint
			for (const file of untrackedFiles.split("\n").filter(Boolean)) {
				try {
					await execFileAsync("git", ["cat-file", "-e", `${hash}:${file}`], { cwd: this.repoRoot })
				} catch {
					await fs.rm(path.join(this.repoRoot, file), { force: true }).catch(() => {})
				}
			}

			// Restore all checkpoint files to the working tree
			await execFileAsync("git", ["restore", `--source=${hash}`, "--worktree", "--", "."], {
				cwd: this.repoRoot,
				maxBuffer: MAX_BUFFER,
			})

			const durationMs = Math.round(performance.now() - startTime)
			Logger.info(`[RefCheckpointTracker] Restored to ${hash} (${durationMs}ms)`)
		} catch (error) {
			Logger.error("[RefCheckpointTracker] Failed to restore checkpoint:", error)
			throw error
		}
	}

	/** Get changed files between two commits, or between a commit and working dir. */
	public async getDiffSet(
		lhsHash: string,
		rhsHash?: string,
	): Promise<Array<{ relativePath: string; absolutePath: string; before: string; after: string }>> {
		try {
			const cleanLhs = this.cleanCommitHash(lhsHash)
			const cleanRhs = rhsHash ? this.cleanCommitHash(rhsHash) : undefined

			const diffArgs = ["diff", "--name-status"]
			if (cleanRhs) {
				diffArgs.push(`${cleanLhs}..${cleanRhs}`)
			} else {
				diffArgs.push(cleanLhs)
			}

			const { stdout } = await execFileAsync("git", diffArgs, {
				cwd: this.repoRoot,
				maxBuffer: MAX_BUFFER,
			})

			const result: Array<{ relativePath: string; absolutePath: string; before: string; after: string }> = []

			for (const line of stdout.split("\n").filter(Boolean)) {
				const [_status, ...pathParts] = line.split("\t")
				const filePath = pathParts.join("\t")
				if (!filePath) continue

				const absolutePath = path.join(this.repoRoot, filePath)

				// Skip binary files for extensionless/dotfiles
				const lastDot = filePath.lastIndexOf(".")
				const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"))
				const ext = lastDot > lastSlash ? filePath.substring(lastDot).toLowerCase() : ""
				const isDotfile = lastDot !== -1 && lastDot === lastSlash + 1
				if (!ext || isDotfile) {
					try {
						if (await isBinaryFile(absolutePath).catch(() => false)) continue
					} catch {
						continue
					}
				}

				let before = ""
				try {
					const { stdout: c } = await execFileAsync("git", ["show", `${cleanLhs}:${filePath}`], {
						cwd: this.repoRoot,
						maxBuffer: MAX_BUFFER,
					})
					before = c
				} catch {
					/* file didn't exist */
				}

				let after = ""
				if (cleanRhs) {
					try {
						const { stdout: c } = await execFileAsync("git", ["show", `${cleanRhs}:${filePath}`], {
							cwd: this.repoRoot,
							maxBuffer: MAX_BUFFER,
						})
						after = c
					} catch {
						/* file doesn't exist */
					}
				} else {
					try {
						after = await fs.readFile(absolutePath, "utf8")
					} catch {
						/* deleted */
					}
				}

				result.push({ relativePath: filePath, absolutePath, before, after })
			}

			return result
		} catch (error) {
			Logger.error("[RefCheckpointTracker] getDiffSet failed:", error)
			return []
		}
	}

	/** Get count of changed files between two commits. */
	public async getDiffCount(lhsHash: string, rhsHash?: string): Promise<number> {
		try {
			const cleanLhs = this.cleanCommitHash(lhsHash)
			const cleanRhs = rhsHash ? this.cleanCommitHash(rhsHash) : undefined
			const diffArgs = ["diff", "--name-only"]
			if (cleanRhs) {
				diffArgs.push(`${cleanLhs}..${cleanRhs}`)
			} else {
				diffArgs.push(cleanLhs)
			}
			const { stdout } = await execFileAsync("git", diffArgs, {
				cwd: this.repoRoot,
				maxBuffer: MAX_BUFFER,
			})
			return stdout.split("\n").filter(Boolean).length
		} catch (error) {
			Logger.error("[RefCheckpointTracker] getDiffCount failed:", error)
			return 0
		}
	}

	/** Delete all refs for this task. Git gc handles unreferenced objects. */
	public async cleanupRefs(): Promise<void> {
		try {
			const { stdout } = await execFileAsync(
				"git",
				["for-each-ref", "--format=%(refname)", `refs/cline/checkpoints/${this.taskId}/`],
				{ cwd: this.repoRoot },
			)
			const refs = stdout.split("\n").filter(Boolean)
			for (const ref of refs) {
				await execFileAsync("git", ["update-ref", "-d", ref], { cwd: this.repoRoot }).catch(() => {})
			}
			Logger.info(`[RefCheckpointTracker] Cleaned up ${refs.length} refs for task ${this.taskId}`)
		} catch (error) {
			Logger.error("[RefCheckpointTracker] cleanupRefs failed:", error)
		}
	}

	/** Static cleanup for when the tracker instance is unavailable. */
	public static async cleanupRefsForTask(taskId: string, workspaceRoot: string): Promise<void> {
		try {
			let repoRoot: string
			try {
				const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
					cwd: workspaceRoot,
					timeout: 5000,
				})
				repoRoot = stdout.trim()
			} catch {
				return // Not a git repo
			}
			const { stdout } = await execFileAsync(
				"git",
				["for-each-ref", "--format=%(refname)", `refs/cline/checkpoints/${taskId}/`],
				{ cwd: repoRoot },
			)
			const refs = stdout.split("\n").filter(Boolean)
			for (const ref of refs) {
				await execFileAsync("git", ["update-ref", "-d", ref], { cwd: repoRoot }).catch(() => {})
			}
			if (refs.length > 0) {
				Logger.info(`[RefCheckpointTracker] Cleaned up ${refs.length} refs for task ${taskId}`)
			}
		} catch (error) {
			Logger.warn("[RefCheckpointTracker] Static cleanup failed (non-fatal):", error)
		}
	}

	private async getHeadCommit(): Promise<string | undefined> {
		try {
			const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: this.repoRoot })
			return stdout.trim() || undefined
		} catch {
			return undefined
		}
	}

	private cleanCommitHash(hash: string): string {
		return hash.startsWith("HEAD ") ? hash.slice(5) : hash
	}
}
