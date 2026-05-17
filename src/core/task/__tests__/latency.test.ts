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

	it("detects remote workspaces for dev-container and codespaces remoteName values", () => {
		isRemoteWorkspaceEnvironment({ remoteName: "dev-container" }).should.equal(true)
		isRemoteWorkspaceEnvironment({ remoteName: "codespaces" }).should.equal(true)
	})

	it("does not classify hosts as remote when remoteName is absent", () => {
		isRemoteWorkspaceEnvironment({
			platform: "Visual Studio Code",
			version: "1.103.0",
			remoteName: undefined,
		}).should.equal(false)
	})

	it("does not classify hosts as remote when remoteName is null", () => {
		isRemoteWorkspaceEnvironment({
			platform: "Visual Studio Code",
			version: "1.103.0",
			remoteName: null,
		}).should.equal(false)
	})

	it("does not false-positive on platform or version strings containing 'remote'", () => {
		// Previously the heuristic would have returned true for these — now it must not.
		isRemoteWorkspaceEnvironment({
			platform: "Remote IDE",
			version: "1.0.0",
		}).should.equal(false)

		isRemoteWorkspaceEnvironment({
			platform: "Visual Studio Code",
			version: "1.0.0-remote-fix",
		}).should.equal(false)
	})

	it("does not classify hosts as remote when no fields are provided", () => {
		isRemoteWorkspaceEnvironment({}).should.equal(false)
	})
})
