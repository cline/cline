/**
 * Unit tests for WorkspaceRootManager
 */

import { describe, it } from "bun:test"
import { VcsType } from "@shared/multi-root/types"
import { expect } from "chai"
import { WorkspaceRootManager } from "../WorkspaceRootManager"

describe("WorkspaceRootManager", () => {
	describe("fromLegacyCwd", () => {
		it("uses the path root as a non-empty workspace name when basename is empty", async () => {
			const manager = await WorkspaceRootManager.fromLegacyCwd("/")
			const roots = manager.getRoots()

			expect(roots).to.have.length(1)
			expect(roots[0]).to.include({
				path: "/",
				name: "/",
				vcs: VcsType.None,
			})
		})
	})

	describe("buildWorkspacesJson", () => {
		it("does not emit an empty hint for a filesystem root workspace", async () => {
			const manager = new WorkspaceRootManager([{ path: "/", vcs: VcsType.None }], 0)

			const json = await manager.buildWorkspacesJson()
			const workspaces = JSON.parse(json!)

			expect(workspaces.workspaces["/"].hint).to.equal("/")
		})

		it("does not emit an empty hint for a Windows drive-root workspace", async () => {
			const manager = new WorkspaceRootManager([{ path: "D:\\\\", vcs: VcsType.None }], 0)

			const json = await manager.buildWorkspacesJson()
			const workspaces = JSON.parse(json!)

			expect(workspaces.workspaces["D:\\\\"].hint).to.equal("D:")
		})
	})
})
