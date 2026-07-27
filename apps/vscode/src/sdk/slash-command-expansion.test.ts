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

	it("expands the other workflow file extensions the SDK discovers", () => {
		expect(expandSlashCommands("/release.markdown", commands)).toBe("Run the release workflow.")
		expect(expandSlashCommands("/release.txt", commands)).toBe("Run the release workflow.")
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
		const disabled = new Set(["release"])
		expect(expandSlashCommands("/release", commands, disabled)).toBe("/release")
		expect(expandSlashCommands("/release.md", commands, disabled)).toBe("/release.md")
		// Skills are governed by frontmatter, not workflow toggles.
		expect(expandSlashCommands("/debug", commands, new Set(["debug"]))).toBe("Use the debugging skill.")
	})
})

describe("buildDisabledWorkflowNames", () => {
	it("indexes disabled workflows by canonical (extension-less, lower-cased) name", () => {
		const disabled = buildDisabledWorkflowNames({
			globalToggles: {
				"/home/user/Documents/Cline/Workflows/Release.md": false,
				"/home/user/Documents/Cline/Workflows/notes.txt": false,
			},
		})
		expect(disabled).toEqual(new Set(["release", "notes"]))
	})

	it("keeps a name enabled when any scope has it enabled", () => {
		// Legacy expansion searched enabled workflows across scopes, so a
		// disabled workspace file must not shadow an enabled global one.
		expect(
			buildDisabledWorkflowNames({
				globalToggles: { "/global/dir/release.md": true },
				workspaceToggles: { "/repo/.clinerules/workflows/release.md": false },
			}),
		).toEqual(new Set())
		expect(
			buildDisabledWorkflowNames({
				globalToggles: { "/global/dir/release.md": false },
				workspaceToggles: { "/repo/.clinerules/workflows/release.md": true },
			}),
		).toEqual(new Set())
	})

	it("collects disabled names from every scope, including remote", () => {
		const disabled = buildDisabledWorkflowNames({
			globalToggles: { "/global/dir/deploy.md": false, "/global/dir/keep.md": true },
			workspaceToggles: { "C:\\repo\\.clinerules\\workflows\\hotfix.md": false },
			remoteToggles: { "org-standards": false, "org-review": true },
		})
		expect(disabled).toEqual(new Set(["deploy", "hotfix", "org-standards"]))
	})

	it("treats locked (alwaysEnabled) remote workflows as enabled despite stale toggles", () => {
		const disabled = buildDisabledWorkflowNames({
			remoteToggles: { "org-standards": false },
			remoteAlwaysEnabledNames: ["org-standards"],
		})
		expect(disabled).toEqual(new Set())
	})
})
