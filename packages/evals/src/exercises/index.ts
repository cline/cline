import * as path from "path"
import * as fs from "fs/promises"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const exercisesPath = path.resolve(__dirname, "..", "..", "..", "..", "..", "evals")

export const exerciseLanguages = ["go", "java", "javascript", "python", "rust"] as const

export type ExerciseLanguage = (typeof exerciseLanguages)[number]

const listDirectories = async (relativePath: string) => {
	try {
		const targetPath = path.resolve(__dirname, relativePath)
		const entries = await fs.readdir(targetPath, { withFileTypes: true })
		return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name)
	} catch (error) {
		console.error(`Error listing directories at ${relativePath}:`, error)
		return []
	}
}

export const getExercisesForLanguage = async (language: ExerciseLanguage) =>
	listDirectories(path.join(exercisesPath, language))
