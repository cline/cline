// npx jest src/schemas/__tests__/index.test.ts

import { contributes } from "../../package.json"

import { GLOBAL_STATE_KEYS, Package, codeActionIds, terminalActionIds, commandIds } from "../index"

describe("GLOBAL_STATE_KEYS", () => {
	it("should contain provider settings keys", () => {
		expect(GLOBAL_STATE_KEYS).toContain("autoApprovalEnabled")
	})

	it("should contain provider settings keys", () => {
		expect(GLOBAL_STATE_KEYS).toContain("anthropicBaseUrl")
	})

	it("should not contain secret state keys", () => {
		expect(GLOBAL_STATE_KEYS).not.toContain("openRouterApiKey")
	})
})

describe("package.json#contributes", () => {
	it("is in sync with the schema's commands", () => {
		// These aren't explicitly referenced in package.json despite
		// being registered by the extension.
		const absent = new Set([
			"activationCompleted",
			"showHumanRelayDialog",
			"registerHumanRelayCallback",
			"unregisterHumanRelayCallback",
			"handleHumanRelayResponse",
		])

		// This test will notify us if package.json drifts from the schema.
		expect(contributes.commands.map((command) => command.command).sort()).toEqual(
			[...new Set([...commandIds, ...terminalActionIds, ...codeActionIds])]
				.filter((id) => !absent.has(id))
				.map((id) => `${Package.name}.${id}`)
				.sort(),
		)
	})
})
