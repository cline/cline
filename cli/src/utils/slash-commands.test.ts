import type { SlashCommandInfo } from "@shared/proto/cline/slash"
import { describe, expect, it } from "vitest"
import { extractSlashQuery, sortCommandsWorkflowsFirst } from "./slash-commands"

describe("slash-commands utils", () => {
	describe("sortCommandsWorkflowsFirst", () => {
		it("sorts sections by priority: skill, custom, default, mcp", () => {
			const commands: SlashCommandInfo[] = [
				{ name: "zz-default", section: "default", description: "", cliCompatible: true },
				{ name: "aa-mcp", section: "mcp", description: "", cliCompatible: true },
				{ name: "bb-workflow", section: "custom", description: "", cliCompatible: true },
				{ name: "cc-skill", section: "skill", description: "", cliCompatible: true },
			]

			const sorted = sortCommandsWorkflowsFirst(commands)
			expect(sorted.map((c) => c.name)).toEqual(["cc-skill", "bb-workflow", "zz-default", "aa-mcp"])
		})
	})

	describe("extractSlashQuery", () => {
		it("supports colon-delimited commands while typing", () => {
			const result = extractSlashQuery("please run /mcp:github:issue_to_fix_workflow")
			expect(result.inSlashMode).toBe(true)
			expect(result.query).toBe("mcp:github:issue_to_fix_workflow")
		})

		it("does not enter slash mode for a second command after a completed colon command", () => {
			const text = "/mcp:github:prompt /skill-candidate"
			const result = extractSlashQuery(text, text.length)
			expect(result.inSlashMode).toBe(false)
			expect(result.query).toBe("")
		})
	})
})
