import { describe, expect, it } from "vitest";
import {
	insertSelectedSkillCommand,
	removeLocalSlashCommandInvocation,
} from "./skill-command-input";

describe("skill command input helpers", () => {
	it("replaces a /skills trigger without clearing existing typed input", () => {
		expect(
			insertSelectedSkillCommand({
				text: "please /skills this file",
				cursorOffset: "please /skills".length,
				commandName: "review",
				replaceRange: {
					start: "please ".length,
					end: "please /skills".length,
				},
			}),
		).toEqual({
			text: "please /review this file",
			cursorOffset: "please /review ".length,
		});
	});

	it("appends a selected skill when the picker opens without a slash trigger", () => {
		expect(
			insertSelectedSkillCommand({
				text: "please inspect this",
				cursorOffset: "please inspect this".length,
				commandName: "review",
			}),
		).toEqual({
			text: "please inspect this /review ",
			cursorOffset: "please inspect this /review ".length,
		});
	});

	it("removes only the /skills trigger when the picker is dismissed", () => {
		expect(
			removeLocalSlashCommandInvocation({
				text: "please /skills this file",
				cursorOffset: "please /skills".length,
				replaceRange: {
					start: "please ".length,
					end: "please /skills".length,
				},
			}),
		).toEqual({
			text: "please this file",
			cursorOffset: "please ".length,
		});
	});

	it("leaves input unchanged when dismissing without a replace range", () => {
		expect(
			removeLocalSlashCommandInvocation({
				text: "please inspect this",
				cursorOffset: 999,
			}),
		).toEqual({
			text: "please inspect this",
			cursorOffset: "please inspect this".length,
		});
	});
});
