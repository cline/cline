import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { generateNotices } from "../../../scripts/third-party-notices/index.ts"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const inputLists = {
	webview: path.resolve(__dirname, "../dist/.third-party/webview-inputs.json"),
	"plugin runtime": path.resolve(__dirname, "../../../sdk/packages/core/dist/plugin-runtime-inputs.json"),
}

function readInputList(label, file, requireAllInputs) {
	if (!fs.existsSync(file)) {
		const message = `[third-party-notices] ${label} input list not found at ${file}; build it before the extension bundle`
		if (requireAllInputs) throw new Error(message)
		console.warn(`${message} (notices will omit it)`)
		return []
	}
	return JSON.parse(fs.readFileSync(file, "utf8"))
}

/** Writes dist/THIRD_PARTY_NOTICES.txt for everything the VSIX ships: extension bundle, webview, plugin runtime, codicons. */
export function writeThirdPartyNotices(extensionMetafile, { requireAllInputs }) {
	const baseDir = path.resolve(__dirname, "..")
	const inputs = [
		...Object.keys(extensionMetafile.inputs).map((input) => path.resolve(baseDir, input)),
		...Object.entries(inputLists).flatMap(([label, file]) => readInputList(label, file, requireAllInputs)),
	]
	const { entries, problems } = generateNotices({
		product: "Cline for Visual Studio Code",
		inputs,
		baseDir,
		extraPackageDirs: [path.dirname(require.resolve("@vscode/codicons/package.json"))],
		outFile: path.join(baseDir, "dist/THIRD_PARTY_NOTICES.txt"),
	})
	console.log(`[third-party-notices] wrote notices for ${entries.length} packages`)
	for (const problem of problems) console.warn(`[third-party-notices] ${problem}`)
}
