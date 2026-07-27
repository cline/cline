import { createHash, randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const execFileAsync = promisify(execFile)
const lockText = await readFile(resolve(repositoryRoot, "bun.lock"), "utf8")
// Bun's text lockfile is JSON with trailing commas. The lockfile does not permit
// comments or unquoted keys, so removing delimiter-adjacent commas is sufficient.
const lock = JSON.parse(lockText.replace(/,(\s*[}\]])/g, "$1"))
const componentByRef = new Map()

function splitPackageIdentifier(identifier) {
	const separator = identifier.lastIndexOf("@")
	if (separator <= 0) return { name: identifier, version: "unknown" }
	return {
		name: identifier.slice(0, separator),
		version: identifier.slice(separator + 1),
	}
}

function purl(name, version) {
	const encodedName = name.startsWith("@")
		? name
				.slice(1)
				.split("/")
				.map((part) => encodeURIComponent(part))
				.join("/")
		: encodeURIComponent(name)
	return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`
}

for (const value of Object.values(lock.packages ?? {})) {
	if (!Array.isArray(value) || typeof value[0] !== "string") continue
	const { name, version } = splitPackageIdentifier(value[0])
	const bomRef = purl(name, version)
	if (componentByRef.has(bomRef)) continue
	const integrity = typeof value[3] === "string" ? value[3] : undefined
	const sha512 = integrity?.startsWith("sha512-") ? integrity.slice("sha512-".length) : undefined
	componentByRef.set(bomRef, {
		type: "library",
		"bom-ref": bomRef,
		group: name.startsWith("@") ? name.slice(1).split("/")[0] : undefined,
		name: name.startsWith("@") ? name.split("/").slice(1).join("/") : name,
		version,
		purl: bomRef,
		...(sha512
			? {
					hashes: [
						{
							alg: "SHA-512",
							content: Buffer.from(sha512, "base64").toString("hex").toUpperCase(),
						},
					],
				}
			: {}),
	})
}

const installedManifestRoots = [
	resolve(repositoryRoot, "node_modules"),
	resolve(repositoryRoot, "apps/vscode/node_modules"),
	resolve(repositoryRoot, "apps/vscode/webview-ui/node_modules"),
]
const packageNames = [
	...new Set(
		[...componentByRef.values()].map((component) =>
			component.group ? `@${component.group}/${component.name}` : component.name,
		),
	),
]
const licensesByPackageName = new Map()
await Promise.all(
	packageNames.map(async (packageName) => {
		for (const manifestRoot of installedManifestRoots) {
			try {
				const manifest = JSON.parse(
					await readFile(resolve(manifestRoot, packageName, "package.json"), "utf8"),
				)
				const declared =
					typeof manifest.license === "string"
						? manifest.license
						: Array.isArray(manifest.licenses)
							? manifest.licenses
									.map((license) => (typeof license === "string" ? license : license?.type))
									.filter(Boolean)
									.join(" OR ")
							: undefined
				if (declared) licensesByPackageName.set(packageName, declared)
				return
			} catch {
				// The lock includes platform and optional packages that are not
				// materialized on this host. Their purl and integrity remain in
				// the SBOM even when license metadata is unavailable locally.
			}
		}
	}),
)
for (const component of componentByRef.values()) {
	const packageName = component.group ? `@${component.group}/${component.name}` : component.name
	const license = licensesByPackageName.get(packageName)
	if (license) component.licenses = [{ license: { name: license } }]
}
const bunStoreRoot = resolve(repositoryRoot, "node_modules/.bun")
const bunStoreEntries = await readdir(bunStoreRoot)
await Promise.all(
	[...componentByRef.values()]
		.filter((component) => !component.licenses)
		.map(async (component) => {
			const packageName = component.group ? `@${component.group}/${component.name}` : component.name
			const storePrefix = `${packageName.replace("/", "+")}@${component.version}`
			const storeEntry = bunStoreEntries.find(
				(entry) => entry === storePrefix || entry.startsWith(`${storePrefix}+`),
			)
			if (!storeEntry) return
			try {
				const manifest = JSON.parse(
					await readFile(resolve(bunStoreRoot, storeEntry, "node_modules", packageName, "package.json"), "utf8"),
				)
				const declared = typeof manifest.license === "string" ? manifest.license : undefined
				if (declared) component.licenses = [{ license: { name: declared } }]
			} catch {
				// Optional/platform packages may have lock entries without a
				// materialized manifest for this release host.
			}
		}),
)

const rootPackage = JSON.parse(await readFile(resolve(repositoryRoot, "apps/vscode/package.json"), "utf8"))
const { stdout: sourceCommitOutput } = await execFileAsync("git", ["rev-parse", "HEAD"], {
	cwd: repositoryRoot,
})
const sourceCommit = sourceCommitOutput.trim()

const bom = {
	bomFormat: "CycloneDX",
	specVersion: "1.5",
	serialNumber: `urn:uuid:${randomUUID()}`,
	version: 1,
	metadata: {
		timestamp: new Date().toISOString(),
		tools: {
			components: [
				{
					type: "application",
					name: "Bedrock Coder Phase 13 SBOM generator",
					version: "1",
				},
			],
		},
		component: {
			type: "application",
			"bom-ref": `pkg:vscode/${rootPackage.publisher}/${rootPackage.name}@${rootPackage.version}`,
			group: rootPackage.publisher,
			name: rootPackage.name,
			version: rootPackage.version,
			properties: [
				{ name: "bedrock-coder:source-commit", value: sourceCommit },
				{ name: "bedrock-coder:lockfile-sha256", value: createHash("sha256").update(JSON.stringify(lock)).digest("hex") },
				{ name: "bedrock-coder:scope", value: "complete Bun lockfile (production and development)" },
			],
		},
	},
	components: [...componentByRef.values()].sort((left, right) => left["bom-ref"].localeCompare(right["bom-ref"])),
}

const outputPath = resolve(repositoryRoot, "security/bedrock-coder.cdx.json")
await writeFile(outputPath, `${JSON.stringify(bom, null, 2)}\n`)
console.log(`[sbom] wrote ${bom.components.length} locked components to ${outputPath}`)
