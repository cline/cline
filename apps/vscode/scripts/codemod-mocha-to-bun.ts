#!/usr/bin/env bun

/**
 * Phase 4b codemod: rewrite mocha-importing unit tests to `bun:test`.
 *
 * For every .ts file that imports from "mocha":
 *   1. Change the module specifier "mocha" -> "bun:test".
 *   2. In that import's named bindings, rename `before` -> `beforeAll` and
 *      `after` -> `afterAll` (mocha's root hooks). `beforeEach`/`afterEach`/
 *      `describe`/`it` are left as-is (same names under bun:test). Existing
 *      aliases (`before as setup`) are preserved by only changing the imported
 *      name, not the local alias.
 *   3. Rewrite call-sites of the renamed hooks in the SAME file: `before(...)`
 *      -> `beforeAll(...)` and `after(...)` -> `afterAll(...)`, but ONLY when
 *      the identifier resolves to the mocha import (not a method call like
 *      `foo.before()` and not `beforeEach`/`afterEach`). If the file aliased
 *      the hook on import, call-sites use the alias and are left untouched.
 *
 * chai / should / sinon imports are intentionally NOT touched — they work as
 * libraries under bun test.
 *
 * Usage:
 *   bun scripts/codemod-mocha-to-bun.ts            # apply to all mocha files
 *   bun scripts/codemod-mocha-to-bun.ts --dry      # report planned edits only
 *   bun scripts/codemod-mocha-to-bun.ts <file...>  # restrict to given files
 */
import path from "node:path"
import { Node, Project, SyntaxKind } from "ts-morph"

const projectRoot = path.resolve(import.meta.dir, "..")

const HOOK_RENAMES: Record<string, string> = {
	before: "beforeAll",
	after: "afterAll",
}

async function main(): Promise<void> {
	const rawArgs = process.argv.slice(2)
	const dryRun = rawArgs.includes("--dry")
	const fileArgs = rawArgs.filter((a) => !a.startsWith("--"))

	const project = new Project({
		tsConfigFilePath: path.join(projectRoot, "tsconfig.json"),
		skipAddingFilesFromTsConfig: true,
	})

	let targetFiles: string[]
	if (fileArgs.length > 0) {
		targetFiles = fileArgs.map((f) => path.resolve(projectRoot, f))
	} else {
		// Glob all .ts under src and filter to those importing "mocha".
		const { Glob } = await import("bun")
		const found: string[] = []
		for await (const m of new Glob("src/**/*.ts").scan({ cwd: projectRoot, onlyFiles: true })) {
			found.push(path.resolve(projectRoot, m))
		}
		targetFiles = found
	}

	const changed: string[] = []
	let skipped = 0

	for (const filePath of targetFiles) {
		const sourceFile = project.addSourceFileAtPath(filePath)
		const mochaImport = sourceFile.getImportDeclarations().find((decl) => decl.getModuleSpecifierValue() === "mocha")

		if (!mochaImport) {
			project.removeSourceFile(sourceFile)
			skipped++
			continue
		}

		// Track which local names correspond to renamed hooks so we can rewrite
		// call-sites. Only rewrite call-sites when NO alias was used (local name
		// equals the original imported name); if aliased, the call-site already
		// uses the alias and the import rename handles the binding.
		const callSiteRenames: Record<string, string> = {}
		// Names that remain imported from bun:test after rename (so we don't
		// re-add them when reconciling global-hook usage below).
		const importedLocalNames = new Set<string>()

		for (const namedImport of mochaImport.getNamedImports()) {
			const importedName = namedImport.getName()
			const aliasNode = namedImport.getAliasNode()
			const rename = HOOK_RENAMES[importedName]
			if (rename) {
				namedImport.setName(rename)
				if (!aliasNode) {
					// e.g. `before` -> `beforeAll`. Call-sites use `before(...)`.
					callSiteRenames[importedName] = rename
				}
			}
			// Local binding name = alias if present, else the (possibly renamed)
			// imported name.
			importedLocalNames.add(aliasNode ? aliasNode.getText() : (rename ?? importedName))
		}

		// Swap the module specifier.
		mochaImport.setModuleSpecifier("bun:test")

		// mocha also exposes describe/it/before/after/beforeEach/afterEach as
		// GLOBALS, so some files call them without importing. bun:test does not
		// inject these as ambient globals for files that import from it, so any
		// bare hook call whose name is not already imported must be added to the
		// import (with before/after mapped to beforeAll/afterAll). Detect such
		// usages and rename before/after call-sites accordingly.
		const MOCHA_GLOBAL_HOOKS = new Set(["describe", "it", "before", "after", "beforeEach", "afterEach"])
		const neededImports = new Set<string>()

		// First pass: rename un-aliased imported before/after call-sites and any
		// global before/after call-sites; collect which hook names are referenced
		// as bare call callees.
		for (const id of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
			const name = id.getText()
			const parent = id.getParent()
			// Must be the callee of a call expression: `hook(...)`.
			if (!Node.isCallExpression(parent) || parent.getExpression() !== id) {
				continue
			}
			// Imported-and-renamed (un-aliased) before/after.
			if (callSiteRenames[name]) {
				id.replaceWithText(callSiteRenames[name])
				neededImports.add(callSiteRenames[name])
				continue
			}
			if (!MOCHA_GLOBAL_HOOKS.has(name)) {
				continue
			}
			// A bare hook call. If it's already an imported local name, nothing to
			// add. Otherwise it relies on the mocha global → must be imported.
			const mapped = HOOK_RENAMES[name] ?? name
			if (importedLocalNames.has(name) || importedLocalNames.has(mapped)) {
				continue
			}
			if (HOOK_RENAMES[name]) {
				id.replaceWithText(HOOK_RENAMES[name])
			}
			neededImports.add(mapped)
		}

		// Add any globally-used hooks that aren't yet imported from bun:test.
		for (const needed of neededImports) {
			if (!importedLocalNames.has(needed)) {
				mochaImport.addNamedImport(needed)
				importedLocalNames.add(needed)
			}
		}

		const relPath = path.relative(projectRoot, filePath)
		changed.push(relPath)
		if (!dryRun) {
			await sourceFile.save()
		}
	}

	console.log(
		`${dryRun ? "[dry-run] " : ""}codemod: ${changed.length} file(s) ${dryRun ? "would change" : "changed"}, ${skipped} skipped (no mocha import)`,
	)
	for (const c of changed.sort()) {
		console.log(`  ${c}`)
	}
}

void main()
