import fs from "fs"
import { createReadStream } from "fs"
import { createInterface } from "readline"

/**
 * Efficiently counts lines in a file using streams without loading the entire file into memory
 *
 * @param filePath - Path to the file to count lines in
 * @returns A promise that resolves to the number of lines in the file
 */
export async function countFileLines(filePath: string): Promise<number> {
	// Check if file exists
	try {
		await fs.promises.access(filePath, fs.constants.F_OK)
	} catch (error) {
		throw new Error(`File not found: ${filePath}`)
	}

	return new Promise((resolve, reject) => {
		let lineCount = 0

		const readStream = createReadStream(filePath)
		const rl = createInterface({
			input: readStream,
			crlfDelay: Infinity,
		})

		rl.on("line", () => {
			lineCount++
		})

		rl.on("close", () => {
			resolve(lineCount)
		})

		rl.on("error", (err) => {
			reject(err)
		})

		readStream.on("error", (err) => {
			reject(err)
		})
	})
}
