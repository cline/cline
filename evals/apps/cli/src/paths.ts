import * as path from "path"
import { fileURLToPath } from "url"

export const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const extensionDevelopmentPath = path.resolve(__dirname, "..", "..", "..", "..")
export const exercisesPath = path.resolve(extensionDevelopmentPath, "..", "evals")
