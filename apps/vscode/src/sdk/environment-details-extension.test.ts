import { mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import * as path from "path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { appendEnvironmentDetailsMessage, formatEnvironmentDetails, normalizeTabPaths } from "./environment-details-extension"

describe("formatEnvironmentDetails", () => {
	it("lists visible files and open tabs under IDE-named headers", () => {
		const details = formatEnvironmentDetails("Visual Studio Code", ["src/app.ts"], ["src/app.ts", "README.md"])

		expect(details).toBe(
			"<environment_details>\n" +
				"# Visual Studio Code Visible Files\nsrc/app.ts\n\n" +
				"# Visual Studio Code Open Tabs\nsrc/app.ts\nREADME.md\n" +
				"</environment_details>",
		)
	})

	it("uses placeholders when nothing is open", () => {
		const details = formatEnvironmentDetails("Visual Studio Code", [], [])

		expect(details).toContain("(No visible files)")
		expect(details).toContain("(No open tabs)")
	})
})

describe("appendEnvironmentDetailsMessage", () => {
	const details = "<environment_details>x</environment_details>"

	it("appends a text part to a trailing plain user message", () => {
		const messages = [
			{ role: "user" as const, content: "hello" },
			{ role: "assistant" as const, content: "hi" },
			{ role: "user" as const, content: [{ type: "text" as const, text: "continue" }] },
		]

		const result = appendEnvironmentDetailsMessage(messages, details)

		expect(result).toHaveLength(3)
		expect(result.slice(0, 2)).toEqual(messages.slice(0, 2))
		expect(result[2]).toEqual({
			role: "user",
			content: [
				{ type: "text", text: "continue" },
				{ type: "text", text: details },
			],
		})
	})

	it("converts a string-content user message to text parts before appending", () => {
		const result = appendEnvironmentDetailsMessage([{ role: "user", content: "hello" }], details)

		expect(result).toEqual([
			{
				role: "user",
				content: [
					{ type: "text", text: "hello" },
					{ type: "text", text: details },
				],
			},
		])
	})

	it("appends a separate user message after tool results", () => {
		const messages = [
			{ role: "user" as const, content: "hello" },
			{ role: "assistant" as const, content: [{ type: "tool_use" as const, id: "t1", name: "read", input: {} }] },
			{
				role: "user" as const,
				content: [{ type: "tool_result" as const, tool_use_id: "t1", name: "read", content: "file body" }],
			},
		]

		const result = appendEnvironmentDetailsMessage(messages, details)

		expect(result).toHaveLength(4)
		expect(result.slice(0, 3)).toEqual(messages)
		expect(result[3]).toEqual({ role: "user", content: [{ type: "text", text: details }] })
	})

	it("returns an empty conversation unchanged", () => {
		expect(appendEnvironmentDetailsMessage([], "details")).toEqual([])
	})
})

describe("normalizeTabPaths", () => {
	let dir: string

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "env-details-"))
		await writeFile(path.join(dir, "a.ts"), "")
		await writeFile(path.join(dir, "b.ts"), "")
	})

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true })
	})

	it("relativizes existing files against cwd and drops missing/duplicate/empty paths", async () => {
		const paths = await normalizeTabPaths(
			[path.join(dir, "a.ts"), path.join(dir, "a.ts"), path.join(dir, "missing.ts"), "", path.join(dir, "b.ts")],
			dir,
		)

		expect(paths).toEqual(["a.ts", "b.ts"])
	})
})
