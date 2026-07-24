import type { MarketplaceEntry, MarketplaceLocalInstalledEntry } from "@shared/proto/cline/marketplace"
import { describe, expect, it } from "vitest"
import { entryMatchesLocalEntry } from "./marketplaceMatch"

function skillEntry(input: Partial<MarketplaceEntry>): MarketplaceEntry {
	return {
		id: input.id ?? "",
		type: "skill",
		name: input.name ?? "",
		install: input.install ?? { args: [] },
	} as MarketplaceEntry
}

function localSkill(input: Partial<MarketplaceLocalInstalledEntry>): MarketplaceLocalInstalledEntry {
	return {
		id: input.id ?? "",
		type: "skill",
		name: input.name ?? "",
		path: input.path ?? "",
		enabled: true,
	} as MarketplaceLocalInstalledEntry
}

describe("marketplace installed row matching", () => {
	it("does not match unrelated installed skills through shared path segments", () => {
		const reviewTeam = skillEntry({
			id: "review-team",
			name: "Review Team",
			install: { args: ["owner/repo", "--skill", "review-team"] },
		})
		const installed = [
			localSkill({
				id: "review-team",
				name: "review-team",
				path: "/home/tester/.agents/skills/review-team/SKILL.md",
			}),
			localSkill({
				id: "sentry-cli",
				name: "sentry-cli",
				path: "/home/tester/.agents/skills/sentry-cli/SKILL.md",
			}),
			localSkill({
				id: "cline-sdk",
				name: "cline-sdk",
				path: "/home/tester/.agents/skills/cline-sdk/SKILL.md",
			}),
		]

		expect(installed.filter((localEntry) => entryMatchesLocalEntry(reviewTeam, localEntry)).map((entry) => entry.id)).toEqual(
			["review-team"],
		)
	})
})
