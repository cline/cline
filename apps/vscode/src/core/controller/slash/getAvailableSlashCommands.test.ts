import type { CoreSettingsItem } from "@cline/core"
import type { ValidatedRemoteSkill } from "@core/context/instructions/user-instructions/skills"
import { describe, expect, it } from "vitest"
import { filterEnabledSkillItems } from "./getAvailableSlashCommands"

function skill(overrides: Partial<CoreSettingsItem>): CoreSettingsItem {
	return {
		id: overrides.id ?? overrides.path ?? overrides.name ?? "test-skill",
		name: overrides.name ?? "test-skill",
		path: overrides.path ?? "/skills/test-skill/SKILL.md",
		kind: "skill",
		source: "global",
		enabled: true,
		...overrides,
	}
}

function remoteSkill(overrides: Partial<ValidatedRemoteSkill> = {}): ValidatedRemoteSkill {
	return {
		name: "remote-skill",
		description: "Remote skill",
		alwaysEnabled: false,
		contents: "# Remote skill",
		...overrides,
	}
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
				skill({ name: "off", path: "/skills/off/SKILL.md", enabled: false }),
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

	it("uses disk-global skill when a workspace skill with the same name exists", () => {
		const result = filterEnabledSkillItems({
			skills: [
				skill({ name: "shared", path: "/project/skills/shared/SKILL.md", source: "workspace" }),
				skill({ name: "shared", path: "/global/skills/shared/SKILL.md", source: "global" }),
			],
			remoteConfigSkills: [],
			remoteSkillsToggles: {},
		})

		expect(result).toHaveLength(1)
		expect(result[0].path).toBe("/global/skills/shared/SKILL.md")
	})

	it("uses remote skill when a local skill with the same name exists", () => {
		const result = filterEnabledSkillItems({
			skills: [skill({ name: "shared", path: "/global/skills/shared/SKILL.md" })],
			remoteConfigSkills: [remoteSkill({ name: "shared" })],
			remoteSkillsToggles: {},
		})

		expect(result).toHaveLength(1)
		expect(result[0].path).toBe("remote:shared")
	})
})
