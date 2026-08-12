import { describe, expect, it } from "vitest";
import type { SlashCommandRegistryEntry } from "../../commands/slash-command-registry";
import {
	buildSkillsPickerRows,
	selectableSkillsPickerRowIndexes,
	skillsPickerCommandMatchesFilter,
} from "./skills-picker-helpers";

function makeCommand(
	name: string,
	overrides?: Partial<SlashCommandRegistryEntry>,
): SlashCommandRegistryEntry {
	return {
		name,
		description: overrides?.description ?? `${name} description`,
		instructions: `${name} instructions`,
		source: "skill",
		kind: "skill",
		execution: "user-command",
		visible: true,
		selectable: true,
		...overrides,
	};
}

describe("buildSkillsPickerRows", () => {
	it("lists top-level skills under a Skills header followed by folder sections", () => {
		const rows = buildSkillsPickerRows(
			[
				makeCommand("zeta"),
				makeCommand("react-review", { folder: "frontend" }),
				makeCommand("alpha"),
				makeCommand("api-audit", { folder: "backend" }),
				makeCommand("css-audit", { folder: "frontend" }),
			],
			"",
		);

		expect(rows).toEqual([
			{ kind: "header", label: "Skills" },
			{ kind: "command", command: expect.objectContaining({ name: "alpha" }) },
			{ kind: "command", command: expect.objectContaining({ name: "zeta" }) },
			{ kind: "header", label: "backend" },
			{
				kind: "command",
				command: expect.objectContaining({ name: "api-audit" }),
			},
			{ kind: "header", label: "frontend" },
			{
				kind: "command",
				command: expect.objectContaining({ name: "css-audit" }),
			},
			{
				kind: "command",
				command: expect.objectContaining({ name: "react-review" }),
			},
		]);
	});

	it("omits the top-level header when every match lives in a folder", () => {
		const rows = buildSkillsPickerRows(
			[
				makeCommand("react-review", { folder: "frontend" }),
				makeCommand("alpha"),
			],
			"react",
		);

		expect(rows).toEqual([
			{ kind: "header", label: "frontend" },
			{
				kind: "command",
				command: expect.objectContaining({ name: "react-review" }),
			},
		]);
	});

	it("appends the marketplace row when requested", () => {
		const rows = buildSkillsPickerRows([makeCommand("alpha")], "", {
			includeMarketplace: true,
		});
		expect(rows.at(-1)).toEqual({ kind: "marketplace" });
	});

	it("keeps nested folder paths as one section label", () => {
		const rows = buildSkillsPickerRows(
			[makeCommand("tailwind-audit", { folder: "frontend/css" })],
			"",
		);
		expect(rows).toEqual([
			{ kind: "header", label: "frontend/css" },
			{
				kind: "command",
				command: expect.objectContaining({ name: "tailwind-audit" }),
			},
		]);
	});
});

describe("skillsPickerCommandMatchesFilter", () => {
	it("matches on name, description, and folder", () => {
		const command = makeCommand("react-review", {
			description: "Review React changes",
			folder: "frontend",
		});
		expect(skillsPickerCommandMatchesFilter(command, "react")).toBe(true);
		expect(skillsPickerCommandMatchesFilter(command, "changes")).toBe(true);
		expect(skillsPickerCommandMatchesFilter(command, "frontend")).toBe(true);
		expect(skillsPickerCommandMatchesFilter(command, "backend")).toBe(false);
	});
});

describe("selectableSkillsPickerRowIndexes", () => {
	it("skips header rows", () => {
		const rows = buildSkillsPickerRows(
			[makeCommand("alpha"), makeCommand("react-review", { folder: "fe" })],
			"",
			{ includeMarketplace: true },
		);
		// header, alpha, header, react-review, marketplace
		expect(selectableSkillsPickerRowIndexes(rows)).toEqual([1, 3, 4]);
	});
});
