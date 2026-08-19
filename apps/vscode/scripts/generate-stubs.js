const fs = require("fs")
const path = require("path")
const { Project, SyntaxKind } = require("ts-morph")

function traverse(container, output, prefix = "") {
	for (const node of container.getStatements()) {
		const kind = node.getKind()

		if (kind === SyntaxKind.ModuleDeclaration) {
			const name = node.getName().replace(/^['"]|['"]$/g, "")
			var fullPrefix
			if (prefix) {
				fullPrefix = `${prefix}.${name}`
			} else {
				fullPrefix = name
			}
			output.push(`${fullPrefix} = {};`)
			const body = node.getBody()
			if (body && body.getKind() === SyntaxKind.ModuleBlock) {
				traverse(body, output, fullPrefix)
			}
		} else if (kind === SyntaxKind.FunctionDeclaration) {
			const name = node.getName()
			const params = node.getParameters().map((p, i) => sanitizeParam(p.getName(), i))
			const typeNode = node.getReturnTypeNode()
			const returnType = typeNode ? typeNode.getText() : ""
			const ret = mapReturn(returnType)
			output.push(
				`${prefix}.${name} = function(${params.join(", ")}) { console.log('Called stubbed function: ${prefix}.${name}');  ${ret} };`,
			)
		} else if (kind === SyntaxKind.EnumDeclaration) {
			const name = node.getName()
			const members = node.getMembers().map((m) => m.getName())
			output.push(`${prefix}.${name} = { ${members.map((m) => `${m}: 0`).join(", ")} };`)
		} else if (kind === SyntaxKind.VariableStatement) {
			for (const decl of node.getDeclarations()) {
				const name = decl.getName()
				output.push(`${prefix}.${name} = createStub("${prefix}.${name}");`)
			}
		} else if (kind === SyntaxKind.ClassDeclaration) {
			const name = node.getName()
			output.push(
				`${prefix}.${name} = class { constructor(...args) {
  console.log('Constructed stubbed class: new ${prefix}.${name}(', args, ')');
  return createStub(${prefix}.${name});
}};`,
			)
		} else if (kind === SyntaxKind.TypeAliasDeclaration || kind === SyntaxKind.InterfaceDeclaration) {
			//console.log("Skipping", SyntaxKind[kind], node.getName())
			// Skip interfaces and type aliases because they are only used at compile time by typescript.
		} else {
			console.log("Can't handle: ", SyntaxKind[kind])
		}
	}
}

function mapReturn(typeStr) {
	if (!typeStr) {
		return ""
	}
	if (typeStr.includes("void")) {
		return ""
	}
	if (typeStr.includes("string")) {
		return `return '';`
	}
	if (typeStr.includes("number")) {
		return `return 0;`
	}
	if (typeStr.includes("boolean")) {
		return `return false;`
	}
	if (typeStr.includes("[]")) {
		return `return [];`
	}
	if (typeStr.includes("Thenable")) {
		return `return Promise.resolve(null);`
	}
	return `return createStub("unknown");`
}

function sanitizeParam(name, index) {
	return name || `arg${index}`
}

async function main() {
	const inputPath = "node_modules/@types/vscode/index.d.ts"
	const outputPath = "standalone/runtime-files/vscode/vscode-stubs.js"

	const project = new Project()
	const sourceFile = project.addSourceFileAtPath(inputPath)

	const output = []
	output.push("// GENERATED CODE -- DO NOT EDIT!")
	output.push('console.log("Loading stubs...");')
	output.push('const { createStub } = require("./stub-utils")')
	traverse(sourceFile, output)
	output.push("module.exports = vscode;")
	output.push('console.log("Finished loading stubs");')

	fs.mkdirSync(path.dirname(outputPath), { recursive: true })
	fs.writeFileSync(outputPath, output.join("\n"))

	console.log(`Wrote vscode SDK stubs to ${outputPath}`)
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
