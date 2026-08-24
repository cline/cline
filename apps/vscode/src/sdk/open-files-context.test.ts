import { mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import * as path from "path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { formatOpenFilesSection, normalizeTabPaths } from "./open-files-context"

describe("formatOpenFilesSection", () => {
	it("lists visible files and open tabs", () => {
		const section = formatOpenFilesSection(["src/app.ts"], ["src/app.ts", "README.md"])

		expect(section).toContain("# Open Files in Editor")
		expect(section).toContain("Visible (active) files:\nsrc/app.ts")
		expect(section).toContain("Open tabs:\nsrc/app.ts\nREADME.md")
		expect(section).toContain('"this file"')
	})

	it("omits empty subsections", () => {
		const section = formatOpenFilesSection([], ["README.md"])

		expect(section).not.toContain("Visible (active) files:")
		expect(section).toContain("Open tabs:\nREADME.md")
	})

	it("returns an empty string when nothing is open", () => {
		expect(formatOpenFilesSection([], [])).toBe("")
	})
})

describe("normalizeTabPaths", () => {
	let dir: string

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "open-files-"))
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
