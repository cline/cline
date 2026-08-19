// Dead-source finder: uses esbuild's own bundle reachability (the same analysis
// that drives tree-shaking + minification mangling) to compute which src/ files
// are reachable from BOTH shipped entry points:
//   - src/extension.ts            (VS Code extension host)
//   - src/standalone/cline-core.ts (standalone host used by JetBrains + CLI)
//
// A src/*.ts file that is NOT in the union of metafile inputs for those two
// builds is unreachable from any shipped entry => dead (modulo dynamic import()
// of computed specifiers, which esbuild surfaces separately).
//
// Run: node scripts/find-dead-src.mjs

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as esbuild from "esbuild"
import { glob } from "glob"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")

const aliases = {
	"@": path.join(root, "src"),
	"@core": path.join(root, "src/core"),
	"@integrations": path.join(root, "src/integrations"),
	"@services": path.join(root, "src/services"),
	"@shared": path.join(root, "src/shared"),
	"@utils": path.join(root, "src/utils"),
	"@packages": path.join(root, "src/packages"),
}

const aliasResolverPlugin = {
	name: "alias-resolver",
	setup(build) {
		for (const [alias, aliasPath] of Object.entries(aliases)) {
			const aliasRegex = new RegExp(`^${alias}($|/.*)`)
			build.onResolve({ filter: aliasRegex }, (args) => {
				const importPath = args.path.replace(alias, aliasPath)
				const exts = [".ts", ".tsx", ".js", ".jsx"]
				if (fs.existsSync(importPath)) {
					const stats = fs.statSync(importPath)
					if (stats.isDirectory()) {
						for (const ext of exts) {
							const idx = path.join(importPath, `index${ext}`)
							if (fs.existsSync(idx)) return { path: idx }
						}
					} else {
						return { path: importPath }
					}
				}
				for (const ext of exts) {
					if (fs.existsSync(`${importPath}${ext}`)) return { path: `${importPath}${ext}` }
				}
				return undefined
			})
		}
	},
}

const common = {
	bundle: true,
	minify: false,
	sourcemap: false,
	logLevel: "silent",
	format: "cjs",
	platform: "node",
	metafile: true,
	write: false,
	absWorkingDir: root,
	tsconfig: path.join(root, "tsconfig.json"),
	packages: "external",
	plugins: [aliasResolverPlugin],
	define: { "process.env.IS_DEV": "false", "process.env.IS_TEST": "false" },
	banner: { js: "const _importMetaUrl=require('url').pathToFileURL(__filename)" },
}

async function inputsFor(entry, external) {
	const r = await esbuild.build({ ...common, entryPoints: [entry], external })
	return new Set(Object.keys(r.metafile.inputs).filter((f) => f.startsWith("src/") && /\.tsx?$/.test(f)))
}

const ext = await inputsFor("src/extension.ts", ["vscode"])
const standalone = await inputsFor("src/standalone/cline-core.ts", [
	"vscode",
	"@grpc/reflection",
	"grpc-health-check",
	"better-sqlite3",
])
const live = new Set([...ext, ...standalone])

// Third consumer: the webview (webview-ui/) is a separate Vite/React build that
// imports extension code ONLY from src/shared (via "@shared/*" alias or relative
// "../src/shared/*" paths). Any src/shared file referenced from webview-ui/src is
// therefore live even if the extension-host/standalone bundles don't reach it.
// Conservatively mark every src/shared file mentioned by the webview as live.
const webviewFiles = await glob("webview-ui/src/**/*.{ts,tsx}", { cwd: root })
const sharedMentionedByWebview = new Set()
for (const wf of webviewFiles) {
	const text = fs.readFileSync(path.join(root, wf), "utf8")
	// Match @shared/X or .../src/shared/X import specifiers and map to src/shared/X
	const re = /(?:@shared\/|src\/shared\/)([A-Za-z0-9_./-]+)/g
	let m
	while ((m = re.exec(text))) {
		const rel = m[1].replace(/\.(ts|tsx|js|jsx)$/, "")
		for (const cand of [`src/shared/${rel}.ts`, `src/shared/${rel}.tsx`, `src/shared/${rel}/index.ts`]) {
			if (fs.existsSync(path.join(root, cand))) sharedMentionedByWebview.add(cand)
		}
	}
}
for (const f of sharedMentionedByWebview) live.add(f)
console.log(`src/shared files referenced by webview: ${sharedMentionedByWebview.size}`)

// All non-test, non-.d.ts source files on disk.
const allSrc = (await glob("src/**/*.{ts,tsx}", { cwd: root }))
	.filter((f) => !/\.test\.tsx?$/.test(f))
	.filter((f) => !f.endsWith(".d.ts"))
	.filter((f) => !f.includes("/__tests__/"))
	.filter((f) => !f.startsWith("src/test/"))
	.filter((f) => !f.startsWith("src/generated/")) // generated host glue
	.filter((f) => !f.startsWith("src/dev/")) // dev-only tooling

const dead = allSrc.filter((f) => !live.has(f)).sort()

console.log(`extension inputs: ${ext.size}`)
console.log(`standalone inputs: ${standalone.size}`)
console.log(`union live src files: ${live.size}`)
console.log(`candidate dead files: ${dead.length}`)
fs.writeFileSync("/tmp/dead-src.json", JSON.stringify(dead, null, "\t"))
console.log("--- dead candidates written to /tmp/dead-src.json ---")
