const fs = require("fs/promises")
const path = require("path")
const simpleGit = require("simple-git")
const crypto = require("crypto")

function getShadowGitPath(globalStoragePath, taskId, cwdHash) {
	return path.join(globalStoragePath, "checkpoints", cwdHash, taskId)
}

function hashWorkingDir(cwd) {
	return crypto.createHash("sha256").update(cwd).digest("hex")
}

class CheckpointManager {
	constructor(globalStoragePath, taskId, cwd) {
		this.globalStoragePath = globalStoragePath
		this.taskId = taskId
		this.cwd = cwd
		this.cwdHash = hashWorkingDir(cwd)
		this.git = simpleGit(this.cwd)
	}

	async getShadowGit() {
		const gitPath = getShadowGitPath(this.globalStoragePath, this.taskId, this.cwdHash)
		const shadowGit = simpleGit(gitPath)
		return shadowGit
	}

	async restoreWorkspace(commitHash) {
		const shadowGit = await this.getShadowGit()
		await shadowGit.raw("reset", "--hard", commitHash)
		// After resetting, we need to checkout the files to the actual workspace
		await shadowGit.raw("checkout", "HEAD", "--", this.cwd)
	}

	async getDiff(commitHash) {
		const shadowGit = await this.getShadowGit()
		const diff = await shadowGit.diff([`${commitHash}^`, commitHash])
		return diff
	}
}

module.exports = { CheckpointManager, getShadowGitPath, hashWorkingDir }
