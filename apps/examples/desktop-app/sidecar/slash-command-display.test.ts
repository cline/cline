import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	clearSlashCommandDisplayCache,
	createSlashCommandDisplayInverter,
} from "./slash-command-display";

describe("createSlashCommandDisplayInverter", () => {
	const tempRoots: string[] = [];

	afterEach(() => {
		clearSlashCommandDisplayCache();
		for (const dir of tempRoots) {
			rmSync(dir, { recursive: true, force: true });
		}
		tempRoots.length = 0;
	});

	function createWorkspaceWithSkill(instructions: string): string {
		const workspace = mkdtempSync(join(tmpdir(), "slash-display-"));
		tempRoots.push(workspace);
		const skillDir = join(workspace, ".cline", "skills", "release-notes");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			`---\nname: release-notes\n---\n${instructions}`,
		);
		return workspace;
	}

	it("inverts persisted expanded prompts back to the typed command", async () => {
		const instructions =
			"# Release Notes Skill\n\nDraft polished release notes.";
		const workspace = createWorkspaceWithSkill(instructions);
		const invert = await createSlashCommandDisplayInverter(workspace);

		expect(
			invert(`<user_input mode="act">${instructions} v1.2 ships</user_input>`),
		).toBe("/release-notes v1.2 ships");
		expect(invert(`<user_input mode="act">${instructions}</user_input>`)).toBe(
			"/release-notes",
		);
		expect(invert(instructions)).toBe("/release-notes");
	});

	it("ignores mode notices prepended to the persisted prompt", async () => {
		const instructions = "Draft polished release notes.";
		const workspace = createWorkspaceWithSkill(instructions);
		const invert = await createSlashCommandDisplayInverter(workspace);

		expect(
			invert(
				`<user_input mode="act"><mode_notice>The user switched modes.</mode_notice>${instructions} now</user_input>`,
			),
		).toBe("/release-notes now");
	});

	it("leaves unrelated and near-miss text unchanged", async () => {
		const instructions = "Draft polished release notes.";
		const workspace = createWorkspaceWithSkill(instructions);
		const invert = await createSlashCommandDisplayInverter(workspace);

		expect(invert("Just a normal question")).toBe("Just a normal question");
		// Instructions followed by a non-whitespace character are not an
		// expansion (the remainder always begins where the typed token ended).
		expect(invert("Draft polished release notes.please")).toBe(
			"Draft polished release notes.please",
		);
	});

	it("returns text unchanged when the workspace has no commands", async () => {
		const workspace = mkdtempSync(join(tmpdir(), "slash-display-empty-"));
		tempRoots.push(workspace);
		const invert = await createSlashCommandDisplayInverter(workspace);

		expect(invert("hello")).toBe("hello");
	});
});
