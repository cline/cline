import { afterEach, describe, expect, it, mock } from "bun:test"
import sinon from "sinon"

const flagEnabled = sinon.stub().returns(false)
mock.module("@/services/feature-flags", () => ({ featureFlagsService: { getBooleanFlagEnabled: flagEnabled } }))

import { isPlanModeMcpLimitsEnabled } from "../planModeMcpLimitsFeature"

describe("isPlanModeMcpLimitsEnabled", () => {
	const savedOverride = process.env.CLINE_PLAN_MODE_MCP_LIMITS

	afterEach(() => {
		if (savedOverride === undefined) {
			delete process.env.CLINE_PLAN_MODE_MCP_LIMITS
		} else {
			process.env.CLINE_PLAN_MODE_MCP_LIMITS = savedOverride
		}
		flagEnabled.reset()
		flagEnabled.returns(false)
	})

	it("follows the rollout flag, which is off until it is fetched as on", () => {
		delete process.env.CLINE_PLAN_MODE_MCP_LIMITS
		expect(isPlanModeMcpLimitsEnabled()).toBe(false)

		flagEnabled.returns(true)
		expect(isPlanModeMcpLimitsEnabled()).toBe(true)
		expect(flagEnabled.lastCall.args).toEqual(["ext-plan-mode-mcp-limits"])
	})

	it("lets the environment force it on or off for local runs", () => {
		process.env.CLINE_PLAN_MODE_MCP_LIMITS = "1"
		expect(isPlanModeMcpLimitsEnabled()).toBe(true)

		flagEnabled.returns(true)
		process.env.CLINE_PLAN_MODE_MCP_LIMITS = "0"
		expect(isPlanModeMcpLimitsEnabled()).toBe(false)
	})
})
