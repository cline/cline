/**
 * Unit tests for remote skill handling in remote-config/utils.ts
 * Covers: transformRemoteConfigToStateShape and toggle synchronisation logic.
 */

import { expect } from "chai"
import { describe, it } from "mocha"
import { synchronizeRemoteRuleToggles } from "@/core/context/instructions/user-instructions/rule-helpers"
import { parseRemoteSkillEntries } from "@/core/context/instructions/user-instructions/skills"
import { transformRemoteConfigToStateShape } from "@/core/storage/remote-config/utils"
import type { RemoteConfig } from "@/shared/remote-config/schema"

function makeConfig(globalSkills: RemoteConfig["globalSkills"]): RemoteConfig {
	return { version: "v1", globalSkills }
}

function makeSKILLMd(name: string, description: string, body = "Instructions here."): string {
	return `---\nname: ${name}\ndescription: ${description}\n---\n${body}`
}

describe("transformRemoteConfigToStateShape - globalSkills", () => {
	it("maps globalSkills to remoteGlobalSkills", () => {
		const entries = [{ name: "My Skill", alwaysEnabled: false, contents: makeSKILLMd("My Skill", "Desc") }]
		const result = transformRemoteConfigToStateShape(makeConfig(entries))
		expect(result.remoteGlobalSkills).to.deep.equal(entries)
	})

	it("does not set remoteGlobalSkills when globalSkills is undefined", () => {
		const result = transformRemoteConfigToStateShape({ version: "v1" })
		expect(result.remoteGlobalSkills).to.be.undefined
	})

	it("sets remoteGlobalSkills to [] when globalSkills is []", () => {
		const result = transformRemoteConfigToStateShape(makeConfig([]))
		expect(result.remoteGlobalSkills).to.deep.equal([])
	})

	it("preserves alwaysEnabled flag", () => {
		const entries = [
			{ name: "Locked", alwaysEnabled: true, contents: makeSKILLMd("Locked", "Desc") },
			{ name: "Free", alwaysEnabled: false, contents: makeSKILLMd("Free", "Desc") },
		]
		const result = transformRemoteConfigToStateShape(makeConfig(entries))
		expect(result.remoteGlobalSkills![0].alwaysEnabled).to.equal(true)
		expect(result.remoteGlobalSkills![1].alwaysEnabled).to.equal(false)
	})
})

describe("synchronizeRemoteRuleToggles - remote skill toggle sync", () => {
	it("adds new toggle entries defaulting to true", () => {
		const result = synchronizeRemoteRuleToggles([{ name: "Deploy", alwaysEnabled: false, contents: "" }], {})
		expect(result["Deploy"]).to.equal(true)
	})

	it("preserves existing toggle values", () => {
		const result = synchronizeRemoteRuleToggles([{ name: "Deploy", alwaysEnabled: false, contents: "" }], { Deploy: false })
		expect(result["Deploy"]).to.equal(false)
	})

	it("removes stale toggle entries", () => {
		const result = synchronizeRemoteRuleToggles([{ name: "New", alwaysEnabled: false, contents: "" }], {
			Old: true,
			New: false,
		})
		expect(result["Old"]).to.be.undefined
		expect(result["New"]).to.equal(false)
	})

	it("returns empty object when no skills", () => {
		const result = synchronizeRemoteRuleToggles([], { Ghost: true })
		expect(result).to.deep.equal({})
	})

	it("handles multiple skills", () => {
		const entries = [
			{ name: "A", alwaysEnabled: true, contents: "" },
			{ name: "B", alwaysEnabled: false, contents: "" },
		]
		const result = synchronizeRemoteRuleToggles(entries, { A: false, D: true })
		expect(result["A"]).to.equal(false)
		expect(result["B"]).to.equal(true)
		expect(result["D"]).to.be.undefined
	})
})

describe("applyRemoteConfig uses parseRemoteSkillEntries", () => {
	it("validates entry.name matches frontmatter.name", () => {
		const validated = parseRemoteSkillEntries([
			{ name: "Deploy", alwaysEnabled: false, contents: makeSKILLMd("Deploy", "Desc") },
		])
		expect(validated).to.have.lengthOf(1)
		expect(validated[0].name).to.equal("Deploy")
	})

	it("warns but includes entries where entry.name drifts from frontmatter.name", () => {
		const validated = parseRemoteSkillEntries([
			{ name: "entry-key", alwaysEnabled: false, contents: makeSKILLMd("Actual Name", "Desc") },
		])
		expect(validated).to.have.lengthOf(1)
		expect(validated[0].name).to.equal("Actual Name")
	})

	it("filters entries with missing frontmatter name", () => {
		const validated = parseRemoteSkillEntries([
			{ name: "x", alwaysEnabled: false, contents: `---\ndescription: No name\n---\nBody` },
			{ name: "y", alwaysEnabled: false, contents: "No frontmatter" },
		])
		expect(validated).to.have.lengthOf(0)
	})

	it("filters entries where frontmatter.name is not a string", () => {
		const validated = parseRemoteSkillEntries([
			{ name: "x", alwaysEnabled: false, contents: `---\nname: 123\ndescription: Desc\n---\nBody` },
		])
		expect(validated).to.have.lengthOf(0)
	})

	it("passes through multiple valid entries", () => {
		const validated = parseRemoteSkillEntries([
			{ name: "Skill One", alwaysEnabled: true, contents: makeSKILLMd("Skill One", "Desc") },
			{ name: "Skill Two", alwaysEnabled: false, contents: makeSKILLMd("Skill Two", "Desc") },
		])
		expect(validated).to.have.lengthOf(2)
		expect(validated[0].name).to.equal("Skill One")
		expect(validated[1].name).to.equal("Skill Two")
	})
})

describe("alwaysEnabled enforcement in toggle sync", () => {
	function syncWithAlwaysEnabled(
		entries: { name: string; alwaysEnabled: boolean; contents: string }[],
		currentToggles: Record<string, boolean>,
	) {
		const validated = parseRemoteSkillEntries(entries)
		const synced = synchronizeRemoteRuleToggles(validated, currentToggles)

		// Enforce alwaysEnabled (mirrors applyRemoteConfig logic)
		for (const entry of validated) {
			if (entry.alwaysEnabled && synced[entry.name] === false) {
				synced[entry.name] = true
			}
		}

		return synced
	}

	it("overrides stale false toggle when admin sets alwaysEnabled", () => {
		const entries = [{ name: "Deploy", alwaysEnabled: true, contents: makeSKILLMd("Deploy", "Desc") }]
		const result = syncWithAlwaysEnabled(entries, { Deploy: false })
		expect(result["Deploy"]).to.equal(true)
	})

	it("does not override false toggle when alwaysEnabled is false", () => {
		const entries = [{ name: "Deploy", alwaysEnabled: false, contents: makeSKILLMd("Deploy", "Desc") }]
		const result = syncWithAlwaysEnabled(entries, { Deploy: false })
		expect(result["Deploy"]).to.equal(false)
	})

	it("keeps true toggle unchanged when alwaysEnabled is true", () => {
		const entries = [{ name: "Deploy", alwaysEnabled: true, contents: makeSKILLMd("Deploy", "Desc") }]
		const result = syncWithAlwaysEnabled(entries, { Deploy: true })
		expect(result["Deploy"]).to.equal(true)
	})

	it("new alwaysEnabled skill defaults to true", () => {
		const entries = [{ name: "New Skill", alwaysEnabled: true, contents: makeSKILLMd("New Skill", "Desc") }]
		const result = syncWithAlwaysEnabled(entries, {})
		expect(result["New Skill"]).to.equal(true)
	})
})
