import { readdir } from "node:fs/promises"
import path from "node:path"

const extensionRoot = path.resolve(import.meta.dir, "..")
const repositoryRoot = path.resolve(extensionRoot, "..", "..")
const manifest = await Bun.file(path.join(extensionRoot, "package.json")).json()

function assert(condition, message) {
	if (!condition) {
		throw new Error(`[identity] ${message}`)
	}
}

assert(manifest.name === "bedrock-coder", `extension name is ${manifest.name}`)
assert(manifest.displayName === "Bedrock Coder", `display name is ${manifest.displayName}`)
assert(manifest.publisher === "fffalexgo", `publisher is ${manifest.publisher}`)
assert(manifest.version === "0.1.0", `version is ${manifest.version}`)
assert(
	manifest.description === "A local-first VS Code coding agent powered exclusively by Amazon Bedrock.",
	"extension description drifted",
)

const expectedRepository = "https://github.com/FFFalexgo/AWS_Bedrock_Coder"
assert(manifest.repository?.url === expectedRepository, "repository URL drifted")
assert(manifest.homepage === expectedRepository, "homepage URL drifted")
assert(manifest.bugs?.url === `${expectedRepository}/issues`, "issues URL drifted")

const commands = new Set((manifest.contributes?.commands ?? []).map(({ command }) => command))
for (const command of commands) {
	assert(command.startsWith("bedrockCoder."), `command uses the wrong namespace: ${command}`)
}

for (const [section, values] of Object.entries(manifest.contributes?.menus ?? {})) {
	for (const entry of values) {
		assert(!entry.command || commands.has(entry.command), `${section} references undeclared command ${entry.command}`)
	}
}

for (const keybinding of manifest.contributes?.keybindings ?? []) {
	assert(commands.has(keybinding.command), `keybinding references undeclared command ${keybinding.command}`)
}

const viewContainerIds = new Set(
	Object.values(manifest.contributes?.viewsContainers ?? {}).flatMap((containers) => containers.map(({ id }) => id)),
)
const viewIds = new Set()
for (const [containerId, views] of Object.entries(manifest.contributes?.views ?? {})) {
	assert(viewContainerIds.has(containerId), `views reference undeclared container ${containerId}`)
	for (const view of views) viewIds.add(view.id)
}
for (const welcome of manifest.contributes?.viewsWelcome ?? []) {
	assert(viewIds.has(welcome.view), `viewsWelcome references undeclared view ${welcome.view}`)
}
for (const entry of manifest.contributes?.menus?.["view/title"] ?? []) {
	const referencedView = entry.when?.match(/\bview\s*==\s*([A-Za-z0-9_.-]+)/)?.[1]
	if (referencedView) assert(viewIds.has(referencedView), `view/title references undeclared view ${referencedView}`)
}

const configurations = Array.isArray(manifest.contributes?.configuration)
	? manifest.contributes.configuration
	: [manifest.contributes?.configuration].filter(Boolean)
for (const configuration of configurations) {
	for (const key of Object.keys(configuration.properties ?? {})) {
		assert(key.startsWith("bedrockCoder."), `setting uses the wrong namespace: ${key}`)
	}
}

const manifestText = JSON.stringify(manifest).toLowerCase()
const forbiddenIdentities = [
	["claude", "-dev"],
	["saoud", "rizwan"],
	["@cl", "ine/"],
	["cl", "ine.bot"],
].map((parts) => parts.join(""))
for (const forbidden of forbiddenIdentities) {
	assert(!manifestText.includes(forbidden), `extension manifest contains ${forbidden}`)
}

const oldName = ["cl", "ine"].join("")
const sourceIdentityPattern = new RegExp(
	`\\b${oldName}\\b|${oldName}\\\\.|\\\\.${oldName}|${oldName}\\\\.bot|@${oldName}/|${oldName.toUpperCase()}_`,
	"i",
)
const checkedExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".mts", ".json", ".proto", ".md", ".toml", ".yaml", ".yml"])
const ignoredDirectories = new Set(["node_modules", "dist", "build", ".vscode-test"])

async function assertSourceIdentity(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
		const candidate = path.join(directory, entry.name)
		if (entry.isDirectory()) {
			await assertSourceIdentity(candidate)
			continue
		}
		if (/^license(?:\.txt)?$/i.test(entry.name) || !checkedExtensions.has(path.extname(entry.name))) continue
		const source = await Bun.file(candidate).text()
		assert(!sourceIdentityPattern.test(source), `${path.relative(repositoryRoot, candidate)} contains old product identity`)
	}
}

await assertSourceIdentity(path.join(repositoryRoot, "apps", "vscode"))
await assertSourceIdentity(path.join(repositoryRoot, "sdk"))

const sdkPackagesDir = path.join(repositoryRoot, "sdk", "packages")
for (const entry of await readdir(sdkPackagesDir, { withFileTypes: true })) {
	if (!entry.isDirectory()) continue
	const packagePath = path.join(sdkPackagesDir, entry.name, "package.json")
	if (!(await Bun.file(packagePath).exists())) continue
	const sdkManifest = await Bun.file(packagePath).json()
	assert(sdkManifest.name?.startsWith("@bedrock-coder/"), `${entry.name} has package name ${sdkManifest.name}`)
	assert(sdkManifest.version === "0.1.0", `${sdkManifest.name} has version ${sdkManifest.version}`)
}

const protoFiles = await readdir(path.join(extensionRoot, "proto", "bedrock_coder"))
assert(
	protoFiles.some((name) => name.endsWith(".proto")),
	"bedrock_coder proto directory is empty",
)
for (const name of protoFiles.filter((candidate) => candidate.endsWith(".proto"))) {
	const source = await Bun.file(path.join(extensionRoot, "proto", "bedrock_coder", name)).text()
	assert(/\bpackage bedrock_coder;/.test(source), `${name} has the wrong proto package`)
}

console.log("[identity] Bedrock Coder manifest, SDK scope, and proto namespace are consistent")
