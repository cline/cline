import type { CoreSettingsItem } from "@cline/core"
import type { GlobalInstructionsFile } from "@shared/remote-config/schema"
import { describe, expect, it } from "vitest"
import { filterEnabledSkillItems } from "./getAvailableSlashCommands"

function skill(overrides: Partial<CoreSettingsItem>): CoreSettingsItem {
	return {
		id: overrides.id ?? overrides.path ?? overrides.name ?? "skill",
		name: overrides.name ?? "skill",
		path: overrides.path ?? "/skills/skill/SKILL.md",
		kind: "skill",
		source: "global",
		enabled: true,
		...overrides,
	}
}

function remoteSkill(overrides: Partial<GlobalInstructionsFile> = {}): GlobalInstructionsFile {
	return {
		name: "remote-skill",
		description: "Remote skill",
		alwaysEnabled: false,
		...overrides,
	} as GlobalInstructionsFile
}

describe("filterEnabledSkillItems", () => {
	it("returns local and remote skills that are not explicitly disabled", () => {
		const result = filterEnabledSkillItems({
			skills: [skill({ name: "alpha", path: "/skills/alpha/SKILL.md" })],
			remoteConfigSkills: [remoteSkill({ name: "beta", alwaysEnabled: true })],
			remoteSkillsToggles: {},
		})

		expect(result.map((s) => s.name)).toEqual(["alpha", "beta"])
	})

	it("skips local skills marked as disabled", () => {
		const result = filterEnabledSkillItems({
			skills: [
				skill({ name: "alpha", path: "/skills/alpha/SKILL.md" }),
				skill({ name: "off", path: "/skills/off/SKILL.md", disabled: true }),
			],
			remoteConfigSkills: [],
			remoteSkillsToggles: {},
		})

		expect(result.map((s) => s.name)).toEqual(["alpha"])
	})

	it("skips remote skills that are explicitly disabled by toggle", () => {
		const result = filterEnabledSkillItems({
			skills: [],
			remoteConfigSkills: [remoteSkill({ name: "remote" })],
			remoteSkillsToggles: { remote: false },
		})

		expect(result).toEqual([])
	})

	it("deduplicates remote skill when a local skill with the same name already exists", () => {
		const result = filterEnabledSkillItems({
			skills: [skill({ name: "shared", path: "/skills/shared/SKILL.md" })],
			remoteConfigSkills: [remoteSkill({ name: "shared" })],
			remoteSkillsToggles: {},
		})

		expect(result).toHaveLength(1)
		expect(result[0].path).toBe("/skills/shared/SKILL.md")
	})
})
