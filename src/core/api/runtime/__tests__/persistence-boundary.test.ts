import { expect } from "chai"
import { describe, it } from "mocha"
import { RuntimePersistenceBoundary } from "../persistence-boundary"
import { createRuntimeStateSourceFixture } from "../test-kit"

describe("RuntimePersistenceBoundary", () => {
	it("projects runtime config without exposing raw state manager internals", () => {
		const boundary = new RuntimePersistenceBoundary()
		const config = boundary.loadRuntimeConfig(
			createRuntimeStateSourceFixture({
				apiConfiguration: {
					actModeApiProvider: "claude-code",
					claudeCodePath: "/usr/local/bin/claude",
					actModeApiModelId: "claude-sonnet",
				},
				settings: {
					actModeApiProvider: "claude-code",
					actModeApiModelId: "claude-sonnet",
					claudeCodePath: "/usr/local/bin/claude",
				},
			}),
			"claude-code",
			"act",
		)

		expect(config.runtimeId).to.equal("claude-code")
		expect(config.legacyProvider).to.equal("claude-code")
		expect(config.resolvedModelId).to.equal("claude-sonnet")
		expect(config.runtimeSpecificFields.claudeCodePath).to.equal("/usr/local/bin/claude")
	})

	it("returns only runtime-scoped credential bindings", () => {
		const boundary = new RuntimePersistenceBoundary()
		const credentialRef = boundary.loadRuntimeCredentials(
			createRuntimeStateSourceFixture({
				secrets: {
					openRouterApiKey: "secret",
					apiKey: "should-not-be-used",
				},
			}),
			"openrouter",
		)

		expect(credentialRef.requiredSecretKeys).to.deep.equal(["openRouterApiKey"])
		expect(credentialRef.availabilityStatus).to.equal("available")
		expect(credentialRef.resolvedSecrets).to.deep.equal({
			openRouterApiKey: "secret",
		})
	})

	it("isolates capability cache records by runtime identity", () => {
		const boundary = new RuntimePersistenceBoundary()

		boundary.recordCapabilityProbe({
			runtimeId: "claude-code",
			probeType: "readiness",
			status: "ready",
			recordedAt: Date.now(),
		})

		expect(boundary.getCapabilityProbe("claude-code")?.status).to.equal("ready")
		expect(boundary.getCapabilityProbe("kiro-cli")).to.equal(undefined)
	})

	it("keeps execution metadata separate from config projection", () => {
		const boundary = new RuntimePersistenceBoundary()

		boundary.recordExecution({
			runtimeId: "claude-code",
			executionKind: "runtime",
			startedAt: 1,
			status: "started",
		})

		expect(boundary.getExecutionRecords("claude-code")).to.have.length(1)
		expect(
			boundary.loadRuntimeConfig(
				createRuntimeStateSourceFixture({
					settings: {
						actModeApiProvider: "claude-code",
					},
				}),
				"claude-code",
				"act",
			).runtimeSpecificFields,
		).to.not.have.property("executionRecords")
	})
})
