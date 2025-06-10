"use server"

import * as path from "path"
import { fileURLToPath } from "url"

import { exerciseLanguages, listDirectories } from "@roo-code/evals"

const __dirname = path.dirname(fileURLToPath(import.meta.url)) // <repo>/apps/web-evals/src/actions

const EVALS_REPO_PATH = path.resolve(__dirname, "../../../../../evals")

export const getExercises = async () => {
	const result = await Promise.all(
		exerciseLanguages.map(async (language) => {
			const languagePath = path.join(EVALS_REPO_PATH, language)
			const exercises = await listDirectories(__dirname, languagePath)
			return exercises.map((exercise) => `${language}/${exercise}`)
		}),
	)

	return result.flat()
}
