import * as path from "path"

import { CheckpointServiceOptions } from "./types"
import { ShadowCheckpointService } from "./ShadowCheckpointService"

export class RepoPerWorkspaceCheckpointService extends ShadowCheckpointService {
	private async checkoutTaskBranch(source: string) {
		if (!this.git) {
			throw new Error("Shadow git repo not initialized")
		}

		const startTime = Date.now()
		const branch = `roo-${this.taskId}`
		const currentBranch = await this.git.revparse(["--abbrev-ref", "HEAD"])

		if (currentBranch === branch) {
			return
		}

		this.log(`[${this.constructor.name}#checkoutTaskBranch{${source}}] checking out ${branch}`)
		const branches = await this.git.branchLocal()
		let exists = branches.all.includes(branch)

		if (!exists) {
			await this.git.checkoutLocalBranch(branch)
		} else {
			await this.git.checkout(branch)
		}

		const duration = Date.now() - startTime

		this.log(
			`[${this.constructor.name}#checkoutTaskBranch{${source}}] ${exists ? "checked out" : "created"} branch "${branch}" in ${duration}ms`,
		)
	}

	override async initShadowGit() {
		return await super.initShadowGit(() => this.checkoutTaskBranch("initShadowGit"))
	}

	override async saveCheckpoint(message: string) {
		await this.checkoutTaskBranch("saveCheckpoint")
		return super.saveCheckpoint(message)
	}

	override async restoreCheckpoint(commitHash: string) {
		await this.checkoutTaskBranch("restoreCheckpoint")
		await super.restoreCheckpoint(commitHash)
	}

	override async getDiff({ from, to }: { from?: string; to?: string }) {
		if (!this.git) {
			throw new Error("Shadow git repo not initialized")
		}

		await this.checkoutTaskBranch("getDiff")

		if (!from && to) {
			from = `${to}~`
		}

		return super.getDiff({ from, to })
	}

	public static create({ taskId, workspaceDir, shadowDir, log = console.log }: CheckpointServiceOptions) {
		const workspaceHash = this.hashWorkspaceDir(workspaceDir)

		return new RepoPerWorkspaceCheckpointService(
			taskId,
			path.join(shadowDir, "checkpoints", workspaceHash),
			workspaceDir,
			log,
		)
	}
}
