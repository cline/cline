import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resolveWorkspaceCloudDefaults } from "./workspace-cloud-defaults"

const execFileAsync = promisify(execFile)

describe("resolveWorkspaceCloudDefaults", () => {
	let root: string
	let clone: string
	const git = (...args: string[]) => execFileAsync("git", args, { cwd: clone })

	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), "cloud-defaults-"))
		const upstream = path.join(root, "upstream.git")
		clone = path.join(root, "clone")
		await execFileAsync("git", ["init", "--bare", "--initial-branch=main", upstream])
		await execFileAsync("git", ["clone", upstream, clone])
		await git("config", "user.email", "fixture@example.test")
		await git("config", "user.name", "Fixture")
		await git("commit", "--allow-empty", "-m", "initial")
		await git("push", "origin", "main")
		// Point origin at GitHub after pushing so the URL is recognised; the
		// remote-tracking refs already recorded are what the lookup reads.
		await git("remote", "set-url", "origin", "git@github.com:cline/fixture.git")
	})

	afterEach(async () => {
		await rm(root, { recursive: true, force: true })
	})

	it("suggests the checked-out branch once it exists on origin", async () => {
		expect(await resolveWorkspaceCloudDefaults(clone)).toEqual({
			repoUrl: "https://github.com/cline/fixture",
			branch: "main",
		})
	})

	it("does not suggest a branch that was never pushed", async () => {
		await git("switch", "-c", "local-only")
		expect(await resolveWorkspaceCloudDefaults(clone)).toEqual({ repoUrl: "https://github.com/cline/fixture" })
	})

	it("suggests the upstream branch when it is named differently", async () => {
		await git("switch", "-c", "renamed-locally", "--track", "origin/main")
		expect(await resolveWorkspaceCloudDefaults(clone)).toMatchObject({ branch: "main" })
	})
})
