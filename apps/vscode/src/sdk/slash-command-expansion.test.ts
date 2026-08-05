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

	it("resolves a typed filename to a frontmatter-renamed workflow via records", () => {
		const renamed = [workflow("ship-it", "Ship it carefully.")]
		const records = [{ name: "ship-it", filePath: "/repo/.clinerules/workflows/release.md" }]
		expect(expandSlashCommands("/release.md", renamed, { workflowRecords: records })).toBe("Ship it carefully.")
		// The renamed command stays governed by its file's toggle.
		expect(
			expandSlashCommands("/release.md", renamed, {
				workflowRecords: records,
				disabledWorkflowNames: new Set(["ship-it"]),
			}),
		).toBe("/release.md")
	})

	it("resolves a typed filename to a frontmatter-renamed workflow whose name normalizes", () => {
		// The SDK normalizes "Ship It" into the token "ship-it", so the typed
		// filename has to resolve through the record id rather than by
		// comparing the configured name against the command token.
		const renamed: AvailableRuntimeCommand[] = [
			{ id: "ship it", name: "ship-it", instructions: "Ship it carefully.", kind: "workflow" },
		]
		const records = [{ id: "ship it", name: "Ship It", filePath: "/repo/.clinerules/workflows/release.md" }]
		expect(expandSlashCommands("/release.md", renamed, { workflowRecords: records })).toBe("Ship it carefully.")
		// The renamed command stays governed by its file's toggle.
		expect(
			expandSlashCommands("/release.md", renamed, {
				workflowRecords: records,
				disabledWorkflowNames: new Set(["Ship It"]),
			}),
		).toBe("/release.md")
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
		expect(expandSlashCommands("/release", commands, { disabledWorkflowNames: disabled })).toBe("/release")
		expect(expandSlashCommands("/release.md", commands, { disabledWorkflowNames: disabled })).toBe("/release.md")
		// Skills are governed by frontmatter, not workflow toggles.
		expect(expandSlashCommands("/debug", commands, { disabledWorkflowNames: new Set(["debug"]) })).toBe(
			"Use the debugging skill.",
		)
	})

	it("applies workflow toggles to normalized runtime command names", () => {
		// The SDK normalizes "Publish UI" into the token "publish-ui", while the
		// toggle set is keyed by the configured name, so the disabled lookup has
		// to go through the record id.
		const normalized = workflow("publish-ui", "Run the publish UI workflow.")
		normalized.id = "publish ui"
		const records = [{ id: "publish ui", name: "Publish UI", filePath: "/repo/workflows/publish-ui.md" }]
		expect(
			expandSlashCommands("/publish-ui", [normalized], {
				workflowRecords: records,
				disabledWorkflowNames: new Set(["Publish UI"]),
			}),
		).toBe("/publish-ui")
	})
})

describe("buildDisabledWorkflowNames", () => {
	it("disables records whose file toggle is off, by exact command name", () => {
		const disabled = buildDisabledWorkflowNames({
			records: [
				{ name: "Release", filePath: "/home/user/Documents/Cline/Workflows/Release.md" },
				{ name: "notes", filePath: "/home/user/Documents/Cline/Workflows/notes.txt" },
				{ name: "keep", filePath: "/home/user/Documents/Cline/Workflows/keep.md" },
			],
			globalToggles: {
				"/home/user/Documents/Cline/Workflows/Release.md": false,
				"/home/user/Documents/Cline/Workflows/notes.txt": false,
				"/home/user/Documents/Cline/Workflows/keep.md": true,
			},
		})
		expect(disabled).toEqual(new Set(["Release", "notes"]))
	})

	it("matches the toggle by file basename even when frontmatter renames the command", () => {
		const disabled = buildDisabledWorkflowNames({
			records: [{ name: "ship-it", filePath: "/repo/.clinerules/workflows/release.md" }],
			workspaceToggles: { "/repo/.clinerules/workflows/release.md": false },
		})
		expect(disabled).toEqual(new Set(["ship-it"]))
	})

	it("keeps a name enabled when any scope has it enabled", () => {
		// Legacy expansion searched enabled workflows across scopes, so a
		// disabled workspace file must not shadow an enabled global one.
		const records = [{ name: "release", filePath: "/repo/.clinerules/workflows/release.md" }]
		expect(
			buildDisabledWorkflowNames({
				records,
				globalToggles: { "/global/dir/release.md": true },
				workspaceToggles: { "/repo/.clinerules/workflows/release.md": false },
			}),
		).toEqual(new Set())
		expect(
			buildDisabledWorkflowNames({
				records,
				globalToggles: { "/global/dir/release.md": false },
				workspaceToggles: { "/repo/.clinerules/workflows/release.md": true },
			}),
		).toEqual(new Set())
	})

	it("governs each command by its own record when similar names span scopes", () => {
		// Distinct commands whose names only differ by case/extension must not
		// influence each other: the disabled remote command stays disabled even
		// though the similarly-named local one is enabled, and vice versa.
		const records = [
			{ name: "Release", filePath: "/repo/.clinerules/workflows/Release.md" },
			{ name: "release", filePath: "/repo/.cline/remote-config/workflows/release.md" },
		]
		expect(
			buildDisabledWorkflowNames({
				records,
				workspaceToggles: { "/repo/.clinerules/workflows/Release.md": true },
				remoteToggles: { release: false },
			}),
		).toEqual(new Set(["release"]))
		expect(
			buildDisabledWorkflowNames({
				records,
				workspaceToggles: { "/repo/.clinerules/workflows/Release.md": false },
				remoteAlwaysEnabledNames: ["release"],
			}),
		).toEqual(new Set(["Release"]))
	})

	it("treats records without any toggle entry as enabled", () => {
		const disabled = buildDisabledWorkflowNames({
			records: [{ name: "fresh", filePath: "/home/user/.cline/workflows/fresh.md" }],
			globalToggles: { "/global/dir/other.md": false },
		})
		expect(disabled).toEqual(new Set())
	})

	it("governs remote-config records by name-keyed remote toggles", () => {
		const disabled = buildDisabledWorkflowNames({
			records: [
				{ name: "org-standards", filePath: "/repo/.cline/remote-config/workflows/org-standards.md" },
				{ name: "org-review", filePath: "/repo/.cline/remote-config/workflows/org-review.md" },
				{ name: "org-default", filePath: "C:\\repo\\.cline\\remote-config\\workflows\\org-default.md" },
			],
			remoteToggles: { "org-standards": false, "org-review": true },
		})
		expect(disabled).toEqual(new Set(["org-standards"]))
	})

	it("keys remote toggles off the materialized filename even when frontmatter aliases the command", () => {
		const disabled = buildDisabledWorkflowNames({
			records: [{ name: "friendly-alias", filePath: "/repo/.cline/remote-config/workflows/org-standards.md" }],
			remoteToggles: { "Org Standards": false },
		})
		expect(disabled).toEqual(new Set(["friendly-alias"]))
	})

	it("matches remote toggles whose config names get sanitized during materialization", () => {
		// "Org Standards" materializes as org-standards.md, and the record is
		// named after the sanitized basename.
		const disabled = buildDisabledWorkflowNames({
			records: [{ name: "org-standards", filePath: "/repo/.cline/remote-config/workflows/org-standards.md" }],
			remoteToggles: { "Org Standards": false },
		})
		expect(disabled).toEqual(new Set(["org-standards"]))
	})

	it("merges colliding sanitized remote names as enabled-if-any-enabled", () => {
		// "Org Standards" and "org standards" both sanitize to org-standards.
		const records = [{ name: "org-standards", filePath: "/repo/.cline/remote-config/workflows/org-standards.md" }]
		expect(
			buildDisabledWorkflowNames({
				records,
				remoteToggles: { "Org Standards": false, "org standards": true },
			}),
		).toEqual(new Set())
		expect(
			buildDisabledWorkflowNames({
				records,
				remoteToggles: { "Org Standards": false, "org standards": false },
			}),
		).toEqual(new Set(["org-standards"]))
	})

	it("matches remote toggles for names longer than the materializer's 80-char cap", () => {
		const longConfigName = "a".repeat(100)
		const materializedName = "a".repeat(80)
		const disabled = buildDisabledWorkflowNames({
			records: [{ name: materializedName, filePath: `/repo/.cline/remote-config/workflows/${materializedName}.md` }],
			remoteToggles: { [longConfigName]: false },
		})
		expect(disabled).toEqual(new Set([materializedName]))
	})

	it("treats locked (alwaysEnabled) remote workflows as enabled despite stale toggles", () => {
		const disabled = buildDisabledWorkflowNames({
			records: [{ name: "org-standards", filePath: "/repo/.cline/remote-config/workflows/org-standards.md" }],
			remoteToggles: { "Org Standards": false },
			remoteAlwaysEnabledNames: ["Org Standards"],
		})
		expect(disabled).toEqual(new Set())
	})

	it("collects disabled names across local and remote scopes", () => {
		const disabled = buildDisabledWorkflowNames({
			records: [
				{ name: "deploy", filePath: "/global/dir/deploy.md" },
				{ name: "keep", filePath: "/global/dir/keep.md" },
				{ name: "hotfix", filePath: "C:\\repo\\.clinerules\\workflows\\hotfix.md" },
				{ name: "org-standards", filePath: "/repo/.cline/remote-config/workflows/org-standards.md" },
			],
			globalToggles: { "/global/dir/deploy.md": false, "/global/dir/keep.md": true },
			workspaceToggles: { "C:\\repo\\.clinerules\\workflows\\hotfix.md": false },
			remoteToggles: { "org-standards": false },
		})
		expect(disabled).toEqual(new Set(["deploy", "hotfix", "org-standards"]))
	})
})
