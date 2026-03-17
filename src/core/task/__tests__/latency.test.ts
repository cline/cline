import { describe, it } from "mocha"
import "should"

import { isRemoteWorkspaceEnvironment } from "../latency"

describe("latency", () => {
	it("detects remote workspaces from explicit remoteName metadata", () => {
		isRemoteWorkspaceEnvironment({
			platform: "Visual Studio Code",
			version: "1.103.0",
			remoteName: "ssh-remote",
		}).should.equal(true)
	})

	it("falls back to platform/version heuristics when explicit metadata is unavailable", () => {
		isRemoteWorkspaceEnvironment({
			platform: "Remote IDE",
			version: "1.0.0",
		}).should.equal(true)
	})

	it("does not classify normal local hosts as remote", () => {
		isRemoteWorkspaceEnvironment({
			platform: "Visual Studio Code",
			version: "1.103.0",
			remoteName: undefined,
		}).should.equal(false)
	})
})
