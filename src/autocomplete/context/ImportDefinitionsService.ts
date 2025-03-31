import { findUriInDirs } from "../../utils/uri"
import { getWorkspaceDirs, gotoDefinition, onDidChangeActiveTextEditor, readFile, readRangeInFile } from "../../utils/vscode"
import { RangeInFileWithContents } from "../types"
import { PrecalculatedLruCache } from "../util/LruCache"
import { getFullLanguageName, getParserForFile, getQueryForFile } from "../util/treeSitter"

interface FileInfo {
	imports: { [key: string]: RangeInFileWithContents[] }
}

export class ImportDefinitionsService {
	static N = 10

	private cache: PrecalculatedLruCache<FileInfo> = new PrecalculatedLruCache<FileInfo>(
		this._getFileInfo.bind(this),
		ImportDefinitionsService.N,
	)

	constructor() {
		onDidChangeActiveTextEditor((filepath) => {
			this.cache.initKey(filepath)
		})
	}

	get(filepath: string): FileInfo | undefined {
		return this.cache.get(filepath)
	}

	private async _getFileInfo(filepath: string): Promise<FileInfo | null> {
		if (filepath.endsWith(".ipynb")) {
			// Commenting out this line was the solution to https://github.com/continuedev/continue/issues/1463
			return null
		}

		const parser = await getParserForFile(filepath)
		if (!parser) {
			return {
				imports: {},
			}
		}

		let fileContents: string | undefined = undefined
		try {
			const { foundInDir } = findUriInDirs(filepath, await getWorkspaceDirs())
			if (!foundInDir) {
				return null
			} else {
				fileContents = await readFile(filepath)
			}
		} catch (err) {
			// File removed
			return null
		}

		const ast = parser.parse(fileContents, undefined, {
			includedRanges: [
				{
					startIndex: 0,
					endIndex: 10_000,
					startPosition: { row: 0, column: 0 },
					endPosition: { row: 100, column: 0 },
				},
			],
		})
		const language = getFullLanguageName(filepath)
		const query = await getQueryForFile(filepath, `import-queries/${language}.scm`)
		if (!query) {
			return {
				imports: {},
			}
		}

		const matches = query?.matches(ast.rootNode)

		const fileInfo: FileInfo = {
			imports: {},
		}
		for (const match of matches) {
			const startPosition = match.captures[0].node.startPosition
			const defs = await gotoDefinition({
				filepath,
				position: {
					line: startPosition.row,
					character: startPosition.column,
				},
			})
			fileInfo.imports[match.captures[0].node.text] = await Promise.all(
				defs.map(async (def) => ({
					...def,
					contents: await readRangeInFile(def.filepath, def.range),
				})),
			)
		}

		return fileInfo
	}
}
