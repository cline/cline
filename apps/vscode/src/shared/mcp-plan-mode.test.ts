import { describe, it } from "bun:test"
import should from "should"
import { getMcpPlanModeAccess } from "./mcp-plan-mode"

describe("getMcpPlanModeAccess", () => {
	it("goes by the server's read-only hint", () => {
		should(getMcpPlanModeAccess({ annotations: { readOnlyHint: true } })).equal("allowed")
		should(getMcpPlanModeAccess({ annotations: { readOnlyHint: false } })).equal("hidden")
	})

	it("asks when the server says nothing", () => {
		should(getMcpPlanModeAccess({})).equal("ask")
		// Other hints say nothing about whether the tool is read-only.
		should(getMcpPlanModeAccess({ annotations: { destructiveHint: false, idempotentHint: true } })).equal("ask")
	})

	it("lets the user allow a tool the server does not declare read-only", () => {
		should(getMcpPlanModeAccess({ allowInPlanMode: true })).equal("allowed")
		should(getMcpPlanModeAccess({ annotations: { readOnlyHint: false }, allowInPlanMode: true })).equal("allowed")
	})

	it("lets the user allow a whole server", () => {
		const server = { allowAllInPlanMode: true }
		should(getMcpPlanModeAccess({}, server)).equal("allowed")
		should(getMcpPlanModeAccess({ annotations: { readOnlyHint: false } }, server)).equal("allowed")
	})

	it("ignores an unset or false override", () => {
		const server = { allowAllInPlanMode: false }
		should(getMcpPlanModeAccess({ allowInPlanMode: false }, server)).equal("ask")
		should(getMcpPlanModeAccess({ annotations: { readOnlyHint: false }, allowInPlanMode: false }, server)).equal("hidden")
	})
})
