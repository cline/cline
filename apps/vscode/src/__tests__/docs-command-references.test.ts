import { describe, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect } from "chai"
import pkg from "../../package.json"

/**
 * The docs tell users who can't find the Cline Activity Bar icon to run a
 * command from the Command Palette. That recovery path is only useful if the
 * command actually exists: docs used to point at "Cline: Open In New Tab",
 * which was never contributed by the extension, leaving users with a dead end.
 *
 * This test pins every `Cline: <Title>` command reference in the docs to a
 * command that the manifest really contributes.
 */

// .../apps/vscode/src/__tests__ -> repo root
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const docsRoot = path.join(repoRoot, "docs")

// Matches Command Palette references like `Cline: Jump to Chat Input`.
const COMMAND_REFERENCE = /Cline: [A-Z][A-Za-z]*(?: [A-Za-z]+)*/g

// Mermaid sequence diagrams use `Actor->>Cline: Start Task` arrows, which look
// exactly like command references but are prose, not commands.
const MERMAID_ARROW = /(?:--?>>?|-->|->)\s*Cline:/

/** How a contributed command appears in the Command Palette. */
function commandPaletteTitle(command: { title: string; category?: string }): string {
	return command.category ? `${command.category}: ${command.title}` : command.title
}

function contributedCommandTitles(): Set<string> {
	return new Set(pkg.contributes.commands.map(commandPaletteTitle))
}

function docsFiles(): string[] {
	return readdirSync(docsRoot, { recursive: true, encoding: "utf8" }).filter((entry) => entry.endsWith(".mdx"))
}

function docsCommandReferences(): Map<string, string[]> {
	const references = new Map<string, string[]>()
	for (const relativePath of docsFiles()) {
		const lines = readFileSync(path.join(docsRoot, relativePath), "utf8").split("\n")
		lines.forEach((line, index) => {
			if (MERMAID_ARROW.test(line)) {
				return
			}
			for (const match of line.match(COMMAND_REFERENCE) ?? []) {
				const locations = references.get(match) ?? []
				locations.push(`${relativePath}:${index + 1}`)
				references.set(match, locations)
			}
		})
	}
	return references
}

describe("docs command references", () => {
	it("only reference commands contributed by the extension manifest", () => {
		const contributed = contributedCommandTitles()
		const referenced = docsCommandReferences()

		// Guard against the regex silently matching nothing (e.g. docs moved),
		// which would make this test vacuously pass.
		expect(referenced.size, "expected the docs to reference at least one Cline command").to.be.greaterThan(0)

		const unknown = [...referenced.entries()]
			.filter(([title]) => !contributed.has(title))
			.map(([title, locations]) => `${title} (referenced at ${locations.join(", ")})`)

		expect(
			unknown,
			`Docs reference Command Palette entries that the extension does not contribute:\n  ${unknown.join("\n  ")}\n` +
				`Contributed commands are:\n  ${[...contributed].sort().join("\n  ")}`,
		).to.deep.equal([])
	})

	it("documents a working recovery path for a hidden Activity Bar icon", () => {
		const referenced = docsCommandReferences()
		const contributed = contributedCommandTitles()

		// The command docs point users at when the icon is missing.
		const recoveryCommand = "Cline: Jump to Chat Input"
		expect(contributed.has(recoveryCommand)).to.be.true
		expect(referenced.has(recoveryCommand), `expected the docs to mention "${recoveryCommand}"`).to.be.true
	})
})
