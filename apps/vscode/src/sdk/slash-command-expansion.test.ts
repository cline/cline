import type { AvailableRuntimeCommand } from "@cline/core"
import { describe, expect, it } from "vitest"
import { buildDisabledWorkflowNames, expandSlashCommands } from "./slash-command-expansion"

function workflow(name: string, instructions: string): AvailableRuntimeCommand {
	return { id: name, name, instructions, kind: "workflow" }
}

function skill(name: string, instructions: string): AvailableRuntimeCommand {
	return { id: name, name, instructions, kind: "skill" }
}

describe("expandSlashCommands", () => {
	const commands = [workflow("release", "Run the release workflow."), skill("debug", "Use the debugging skill.")]

	it("expands a leading workflow command", () => {
		expect(expandSlashCommands("/release", commands)).toBe("Run the release workflow.")
		expect(expandSlashCommands("/release now", commands)).toBe("Run the release workflow. now")
	})

	it("expands the legacy filename spelling with the .md extension", () => {
		expect(expandSlashCommands("/release.md now", commands)).toBe("Run the release workflow. now")
	})

	it("matches case-insensitively as a fallback, like webview validation", () => {
		expect(expandSlashCommands("/Release.MD", commands)).toBe("Run the release workflow.")
	})

	it("expands a command that appears mid-message after whitespace", () => {
		expect(expandSlashCommands("please run /release.md for v2", commands)).toBe("please run Run the release workflow. for v2")
	})

	it("only expands the first matching command", () => {
		expect(expandSlashCommands("/release then /debug", commands)).toBe("Run the release workflow. then /debug")
	})

	it("skips unknown commands but still expands a later known one", () => {
		expect(expandSlashCommands("/newtask use /release", commands)).toBe("/newtask use Run the release workflow.")
	})

	it("expands skills by name", () => {
		expect(expandSlashCommands("/debug this failure", commands)).toBe("Use the debugging skill. this failure")
	})

	it("does not treat path segments as commands", () => {
		expect(expandSlashCommands("look at /release/notes.txt", commands)).toBe("look at /release/notes.txt")
	})

	it("returns unknown commands unchanged", () => {
		expect(expandSlashCommands("/missing", commands)).toBe("/missing")
		expect(expandSlashCommands("no commands here", commands)).toBe("no commands here")
	})

	it("skips workflows the user disabled via toggles", () => {
		const disabled = new Set(["release", "release.md"])
		expect(expandSlashCommands("/release", commands, disabled)).toBe("/release")
		expect(expandSlashCommands("/release.md", commands, disabled)).toBe("/release.md")
		// Skills are governed by frontmatter, not workflow toggles.
		expect(expandSlashCommands("/debug", commands, new Set(["debug"]))).toBe("Use the debugging skill.")
	})
})

describe("buildDisabledWorkflowNames", () => {
	it("indexes disabled workflows by basename with and without extension", () => {
		const disabled = buildDisabledWorkflowNames({ "/home/user/Documents/Cline/Workflows/Release.md": false }, undefined)
		expect(disabled).toEqual(new Set(["release.md", "release"]))
	})

	it("lets workspace toggles override global toggles for the same file name", () => {
		const disabled = buildDisabledWorkflowNames(
			{ "/global/dir/release.md": false },
			{ "/repo/.clinerules/workflows/release.md": true },
		)
		expect(disabled.size).toBe(0)
	})

	it("collects disabled names from both scopes", () => {
		const disabled = buildDisabledWorkflowNames(
			{ "/global/dir/deploy.md": false, "/global/dir/keep.md": true },
			{ "C:\\repo\\.clinerules\\workflows\\hotfix.md": false },
		)
		expect(disabled).toEqual(new Set(["deploy.md", "deploy", "hotfix.md", "hotfix"]))
	})
})
