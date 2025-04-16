import path from "path"
import { GlobalFileNames } from "../../../storage/disk"
import { fileExistsAtPath, isDirectory, readDirectory } from "../../../../utils/fs"
import { formatResponse } from "../../../prompts/responses"
import fs from "fs/promises"

export const getGlobalClineRules = async (globalClineRulesFilePath: string) => {
	if (await fileExistsAtPath(globalClineRulesFilePath)) {
		if (await isDirectory(globalClineRulesFilePath)) {
			try {
				const rulesFilePaths = await readDirectory(globalClineRulesFilePath)
				const rulesFilesTotalContent = await getClineRulesFilesTotalContent(rulesFilePaths, globalClineRulesFilePath)
				const clineRulesFileInstructions = formatResponse.clineRulesGlobalDirectoryInstructions(rulesFilesTotalContent)
				return clineRulesFileInstructions
			} catch {
				console.error(`Failed to read .clinerules directory at ${globalClineRulesFilePath}`)
			}
		} else {
			console.error(`${globalClineRulesFilePath} is not a directory`)
			return undefined
		}
	}

	return undefined
}

export const getLocalClineRules = async (cwd: string) => {
	const clineRulesFilePath = path.resolve(cwd, GlobalFileNames.clineRules)

	let clineRulesFileInstructions: string | undefined

	if (await fileExistsAtPath(clineRulesFilePath)) {
		if (await isDirectory(clineRulesFilePath)) {
			try {
				const rulesFilePaths = await readDirectory(path.join(cwd, GlobalFileNames.clineRules))
				const rulesFilesTotalContent = await getClineRulesFilesTotalContent(rulesFilePaths, cwd)
				clineRulesFileInstructions = formatResponse.clineRulesLocalDirectoryInstructions(cwd, rulesFilesTotalContent)
			} catch {
				console.error(`Failed to read .clinerules directory at ${clineRulesFilePath}`)
			}
		} else {
			try {
				const ruleFileContent = (await fs.readFile(clineRulesFilePath, "utf8")).trim()
				if (ruleFileContent) {
					clineRulesFileInstructions = formatResponse.clineRulesLocalFileInstructions(cwd, ruleFileContent)
				}
			} catch {
				console.error(`Failed to read .clinerules file at ${clineRulesFilePath}`)
			}
		}
	}

	return clineRulesFileInstructions
}

const getClineRulesFilesTotalContent = async (rulesFilePaths: string[], basePath: string) => {
	const ruleFilesTotalContent = await Promise.all(
		rulesFilePaths.map(async (filePath) => {
			const ruleFilePath = path.resolve(basePath, filePath)
			const ruleFilePathRelative = path.relative(basePath, ruleFilePath)
			return `${ruleFilePathRelative}\n` + (await fs.readFile(ruleFilePath, "utf8")).trim()
		}),
	).then((contents) => contents.join("\n\n"))
	return ruleFilesTotalContent
}
