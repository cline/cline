import { expect } from "chai"
import { describe, it } from "mocha"
import { isAiHydroServerName } from "../aiHydroServer"

describe("isAiHydroServerName", () => {
	// Regression guard: a strict `=== "ai-hydro"` check silently disabled
	// _chat_id / _workspace injection for every server alias users actually
	// register, so chat↔study binding never fired and aihydro_chat_status
	// always reported bound:false. These aliases MUST all match.
	const aiHydroAliases = [
		"ai-hydro",
		"aihydro",
		"aihydro-tools",
		"aihydro-core",
		"aihydro-data",
		"ai-hydro-tools",
		"aihydro_core",
		"AI-Hydro",
		"AIHYDRO",
		"  aihydro-tools  ", // tolerant of incidental whitespace
	]

	for (const name of aiHydroAliases) {
		it(`matches ai-hydro family member: ${JSON.stringify(name)}`, () => {
			expect(isAiHydroServerName(name)).to.equal(true)
		})
	}

	const nonAiHydro = [
		"swatplus-builder",
		"pyhmt2d",
		"hydromind",
		"my-aihydro-fork", // does not START with the family prefix
		"hydro",
		"",
		undefined,
	]

	for (const name of nonAiHydro) {
		it(`does not match non-family server: ${JSON.stringify(name)}`, () => {
			expect(isAiHydroServerName(name)).to.equal(false)
		})
	}
})
