import * as path from "path"
import { fileExistsAtPath } from "@utils/fs"
import { String } from "@shared/proto/common"

const isWindows = /^win/.test(process.platform)
const binName = isWindows ? "rg.exe" : "rg"

//const MAX_RESULTS = 300

export async function getBinPath(request: String): Promise<String> {
	const vscodeAppRoot = request.value
	const checkPath = async (pkgFolder: string) => {
		const fullPath = path.join(vscodeAppRoot, pkgFolder, binName)
		return (await fileExistsAtPath(fullPath)) ? fullPath : undefined
	}

	const result = await ((await checkPath("node_modules/@vscode/ripgrep/bin/")) ||
		(await checkPath("node_modules/vscode-ripgrep/bin")) ||
		(await checkPath("node_modules.asar.unpacked/vscode-ripgrep/bin/")) ||
		(await checkPath("node_modules.asar.unpacked/@vscode/ripgrep/bin/")))

	return String.create({ value: result || "" })
}
