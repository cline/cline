import path from "path"
import { GlobalFileNames } from "../../../storage/disk"
import { fileExistsAtPath, isDirectory, readDirectory } from "../../../../utils/fs"
import { formatResponse } from "../../../prompts/responses"
import fs from "fs/promises"

export const getClineRules = async (cwd: string) => {
	const clineRulesFilePath = path.resolve(cwd, GlobalFileNames.clineRules)

	let clineRulesFileInstructions: string | undefined

	if (await fileExistsAtPath(clineRulesFilePath)) {
		if (await isDirectory(clineRulesFilePath)) {
			try {
				const rulesFilePaths = await readDirectory(path.join(cwd, GlobalFileNames.clineRules))
				const rulesFilesTotalContent = await getClineRulesFilesTotalContent(rulesFilePaths, cwd)
				clineRulesFileInstructions = formatResponse.clineRulesDirectoryInstructions(cwd, rulesFilesTotalContent)
			} catch {
				console.error(`Failed to read .clinerules directory at ${clineRulesFilePath}`)
			}
		} else {
			try {
				const ruleFileContent = (await fs.readFile(clineRulesFilePath, "utf8")).trim()
				if (ruleFileContent) {
					clineRulesFileInstructions = formatResponse.clineRulesFileInstructions(cwd, ruleFileContent)
				}
			} catch {
				console.error(`Failed to read .clinerules file at ${clineRulesFilePath}`)
			}
		}
	}

	return clineRulesFileInstructions
}

const getClineRulesFilesTotalContent = async (rulesFilePaths: string[], cwd: string) => {
	const ruleFilesTotalContent = await Promise.all(
		rulesFilePaths.map(async (filePath) => {
			const ruleFilePath = path.resolve(cwd, filePath)
			const ruleFilePathRelative = path.relative(cwd, ruleFilePath)
			return `${ruleFilePathRelative}\n` + (await fs.readFile(ruleFilePath, "utf8")).trim()
		}),
	).then((contents) => contents.join("\n\n"))
	return ruleFilesTotalContent
}
