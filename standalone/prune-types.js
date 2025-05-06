const fs = require("fs")
const path = require("path")
const { Project, SyntaxKind } = require("ts-morph")

const USED_TYPES = "build/vscode-uses.txt"
const VSCODE_TYPES = "../node_modules/@types/vscode/index.d.ts"
const PRUNED_VSCODE_TYPES = "build/index-pruned.d.ts"

const typesPath = path.resolve(USED_TYPES)
const inputPath = path.resolve(VSCODE_TYPES)
const outputPath = path.resolve(PRUNED_VSCODE_TYPES)

const usedTypes = new Set(
	fs
		.readFileSync(typesPath, "utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean),
)

function isTypeUsed(name, usedTypes) {
	for (const t of usedTypes) {
		if (t === name || t.startsWith(name + ".")) return true
	}
	return false
}

function prune(container, prefix = "") {
	for (const child of container.getStatements()) {
		const kind = child.getKind()

		if (kind === SyntaxKind.ModuleDeclaration) {
			const name = child.getName().replace(/^['"]|['"]$/g, "") // remove quotes.
			const nextPrefix = prefix ? `${prefix}.${name}` : name

			const body = child.getBody()
			if (!body) continue

			// Always recurse
			prune(body, nextPrefix)

			const isUsed = isTypeUsed(nextPrefix, usedTypes)
			const isEmpty = body.getKind() === SyntaxKind.ModuleBlock && body.getStatements().length === 0

			if (!isUsed && isEmpty) {
				child.remove()
			}
		} else if (
			kind === SyntaxKind.InterfaceDeclaration ||
			kind === SyntaxKind.ClassDeclaration ||
			kind === SyntaxKind.TypeAliasDeclaration ||
			kind === SyntaxKind.EnumDeclaration ||
			kind === SyntaxKind.FunctionDeclaration
		) {
			const name = child.getName().replace(/^['"]|['"]$/g, "")
			const fqn = prefix ? `${prefix}.${name}` : name
			//console.log('sss Checking', fqn)
			if (!isTypeUsed(fqn, usedTypes)) {
				child.remove()
			}
		}
	}
}

const project = new Project()
const sourceFile = project.addSourceFileAtPath(inputPath)

prune(sourceFile)

let textWithoutComments = "// GENERATED CODE -- DO NOT EDIT!\n"
textWithoutComments += sourceFile
	.getFullText()
	.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "") // remove all comments
	.replace(/^\s*[\r\n]/gm, "") // remove all empty lines

fs.writeFileSync(outputPath, textWithoutComments)
console.log(`Wrote pruned output to ${outputPath}`)
