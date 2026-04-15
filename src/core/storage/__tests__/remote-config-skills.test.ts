/**
 * Unit tests for remote skill handling in remote-config/utils.ts
 * Covers: transformRemoteConfigToStateShape and toggle synchronisation logic.
 */

import { expect } from "chai"
import { describe, it } from "mocha"
import { transformRemoteConfigToStateShape } from "@/core/storage/remote-config/utils"
import { synchronizeRemoteRuleToggles } from "@/core/context/instructions/user-instructions/rule-helpers"
import { parseYamlFrontmatter } from "@/core/context/instructions/user-instructions/frontmatter"
import type { RemoteConfig } from "@/shared/remote-config/schema"

function makeConfig(globalSkills: RemoteConfig["globalSkills"]): RemoteConfig {
	return { version: "v1", globalSkills }
}

function makeSKILLMd(name: string, description: string, body = "Instructions here."): string {
	return `---\nname: ${name}\ndescription: ${description}\n---\n${body}`
}

describe("transformRemoteConfigToStateShape - globalSkills", () => {
	it("maps globalSkills to remoteGlobalSkills", () => {
		const entries = [{ name: "s1", alwaysEnabled: false, contents: makeSKILLMd("My Skill", "Desc") }]
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
			{ name: "locked", alwaysEnabled: true, contents: makeSKILLMd("Locked", "Desc") },
			{ name: "unlocked", alwaysEnabled: false, contents: makeSKILLMd("Free", "Desc") },
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
		const result = synchronizeRemoteRuleToggles([{ name: "New", alwaysEnabled: false, contents: "" }], { Old: true, New: false })
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

describe("applyRemoteConfig skill frontmatter parsing pattern", () => {
	const parse = (entries: { name: string; alwaysEnabled: boolean; contents: string }[]) =>
		entries
			.map((entry) => {
				const { data } = parseYamlFrontmatter(entry.contents)
				return typeof data.name === "string" ? { ...entry, name: data.name } : null
			})
			.filter((e): e is NonNullable<typeof e> => e !== null)

	it("uses frontmatter.name not entry.name as identity", () => {
		const parsed = parse([{ name: "entry-key", alwaysEnabled: false, contents: makeSKILLMd("Actual Name", "Desc") }])
		expect(parsed).to.have.lengthOf(1)
		expect(parsed[0].name).to.equal("Actual Name")
	})

	it("filters entries with missing frontmatter name", () => {
		const parsed = parse([
			{ name: "x", alwaysEnabled: false, contents: `---\ndescription: No name\n---\nBody` },
			{ name: "y", alwaysEnabled: false, contents: "No frontmatter" },
		])
		expect(parsed).to.have.lengthOf(0)
	})

	it("filters entries where frontmatter.name is not a string", () => {
		const parsed = parse([{ name: "x", alwaysEnabled: false, contents: `---\nname: 123\ndescription: Desc\n---\nBody` }])
		expect(parsed).to.have.lengthOf(0)
	})

	it("passes through multiple valid entries", () => {
		const parsed = parse([
			{ name: "a", alwaysEnabled: true, contents: makeSKILLMd("Skill One", "Desc") },
			{ name: "b", alwaysEnabled: false, contents: makeSKILLMd("Skill Two", "Desc") },
		])
		expect(parsed).to.have.lengthOf(2)
		expect(parsed[0].name).to.equal("Skill One")
		expect(parsed[1].name).to.equal("Skill Two")
	})
})
