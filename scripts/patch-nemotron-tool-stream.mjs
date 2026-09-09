import fs from "node:fs"

const file = "apps/vscode/src/core/api/providers/bedrock.ts"
let source = fs.readFileSync(file, "utf8")

function replaceOnce(before, after, label) {
	const count = source.split(before).length - 1
	if (count !== 1) {
		throw new Error(`${label}: expected exactly one match, found ${count}`)
	}
	source = source.replace(before, after)
}

replaceOnce(
	'\t\t\t\tconst activeToolCalls: Map<number, { toolUseId: string; name: string }> = new Map()\n',
	'\t\t\t\tconst activeToolCalls: Map<number, { toolUseId: string; name: string }> = new Map()\n\t\t\t\t// Bedrock ConverseStream may split toolUse.input JSON across multiple deltas.\n\t\t\t\t// Buffer each tool call until contentBlockStop so Cline never validates partial arguments.\n\t\t\t\tconst toolInputBuffers = new Map<number, string>()\n',
	"tool input buffer declaration",
)

replaceOnce(
`\t\t\t\t\t\t\t} else if (delta?.toolUse?.input !== undefined) {
\t\t\t\t\t\t\t\tconst toolCall = activeToolCalls.get(blockIndex)
\t\t\t\t\t\t\t\tconst toolInput = delta.toolUse.input
\t\t\t\t\t\t\t\tif (toolCall && typeof toolInput === "string") {
\t\t\t\t\t\t\t\t\tyield {
\t\t\t\t\t\t\t\t\t\ttype: "tool_calls",
\t\t\t\t\t\t\t\t\t\ttool_call: {
\t\t\t\t\t\t\t\t\t\t\tcall_id: toolCall.toolUseId,
\t\t\t\t\t\t\t\t\t\t\tfunction: {
\t\t\t\t\t\t\t\t\t\t\t\tid: toolCall.toolUseId,
\t\t\t\t\t\t\t\t\t\t\t\tname: toolCall.name,
\t\t\t\t\t\t\t\t\t\t\t\targuments: toolInput,
\t\t\t\t\t\t\t\t\t\t\t},
\t\t\t\t\t\t\t\t\t\t},
\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t}
`,
`\t\t\t\t\t\t\t} else if (delta?.toolUse?.input !== undefined) {
\t\t\t\t\t\t\t\tconst toolInput = delta.toolUse.input
\t\t\t\t\t\t\t\tif (activeToolCalls.has(blockIndex) && typeof toolInput === "string") {
\t\t\t\t\t\t\t\t\ttoolInputBuffers.set(blockIndex, (toolInputBuffers.get(blockIndex) || "") + toolInput)
\t\t\t\t\t\t\t\t}
`,
	"streamed tool input handling",
)

replaceOnce(
`\t\t\t\t\t\tif (blockIndex !== undefined) {
\t\t\t\t\t\t\t// Clean up buffers and tracking for this block
\t\t\t\t\t\t\tdelete contentBuffers[blockIndex]
\t\t\t\t\t\t\tblockTypes.delete(blockIndex)
\t\t\t\t\t\t\tactiveToolCalls.delete(blockIndex)
\t\t\t\t\t\t}
`,
`\t\t\t\t\t\tif (blockIndex !== undefined) {
\t\t\t\t\t\t\tconst toolCall = activeToolCalls.get(blockIndex)
\t\t\t\t\t\t\tif (toolCall) {
\t\t\t\t\t\t\t\tyield {
\t\t\t\t\t\t\t\t\ttype: "tool_calls",
\t\t\t\t\t\t\t\t\ttool_call: {
\t\t\t\t\t\t\t\t\t\tcall_id: toolCall.toolUseId,
\t\t\t\t\t\t\t\t\t\tfunction: {
\t\t\t\t\t\t\t\t\t\t\tid: toolCall.toolUseId,
\t\t\t\t\t\t\t\t\t\t\tname: toolCall.name,
\t\t\t\t\t\t\t\t\t\t\targuments: toolInputBuffers.get(blockIndex) || "{}",
\t\t\t\t\t\t\t\t\t\t},
\t\t\t\t\t\t\t\t\t},
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t}

\t\t\t\t\t\t\t// Clean up buffers and tracking for this block
\t\t\t\t\t\t\tdelete contentBuffers[blockIndex]
\t\t\t\t\t\t\tblockTypes.delete(blockIndex)
\t\t\t\t\t\t\tactiveToolCalls.delete(blockIndex)
\t\t\t\t\t\t\ttoolInputBuffers.delete(blockIndex)
\t\t\t\t\t\t}
`,
	"tool call completion handling",
)

fs.writeFileSync(file, source)

// Build a new artifact version without permanently rewriting the pinned source line.
for (const packageFile of ["apps/vscode/package.json", "apps/vscode/package-lock.json"]) {
	const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"))
	pkg.version = "4.0.12-prompt-patch.10"
	if (packageFile.endsWith("package-lock.json") && pkg.packages?.[""]) {
		pkg.packages[""].version = "4.0.12-prompt-patch.10"
	}
	fs.writeFileSync(packageFile, `${JSON.stringify(pkg, null, "\t")}\n`)
}

console.log("Applied Nemotron/Bedrock native tool stream buffering patch and set build version to 4.0.12-prompt-patch.10")
